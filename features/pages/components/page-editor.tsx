"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
	type KeyboardEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useCurrentUser } from "@/components/app-session-provider";
import { useCollabSession } from "@/features/collab/client/session";
import { cursorColorFor, pageRoomId } from "@/features/collab/lib/room";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	consumeTitleFocus,
	releaseTitleKeyboardPrime,
} from "@/features/pages/client/new-page-focus";
import {
	getPageQueryOptions,
	invalidatePage,
	invalidatePages,
	setPageTitleInCache,
	updatePageMutationOptions,
} from "@/features/pages/client/queries";
import { setPageSaveState } from "@/features/pages/client/save-state";
import { useSharedTitle } from "@/features/pages/client/use-shared-title";
import { cn } from "@/lib/utils";
import { Backlinks } from "./backlinks";
import { EditorBodySkeleton, PageEditorSkeleton } from "./page-editor-skeleton";
import { PageIconButton } from "./page-icon-picker";

const HaunterEditor = dynamic(() => import("./editor/haunter-editor"), {
	ssr: false,
	loading: () => (
		<div className="py-2">
			<EditorBodySkeleton />
		</div>
	),
});

// Shown while the collab room connects: the Liveblocks websocket upgrade
// takes 1-2s on cold rooms (server-side; measured, not our stack), and the
// page content is already fetched — so paint it read-only immediately
// instead of a skeleton. The live editor swaps in when the room is ready.
const ReadOnlyEditor = dynamic(() => import("./editor/read-only-editor"), {
	ssr: false,
	loading: () => (
		<div className="py-2">
			<EditorBodySkeleton />
		</div>
	),
});

const TITLE_SAVE_DELAY_MS = 500;

function normalizeTitleInput(value: string) {
	return value.replace(/[\r\n]+/g, " ");
}

function resizeTitleTextarea(textarea: HTMLTextAreaElement | null) {
	if (!textarea) return;
	textarea.style.height = "0px";
	textarea.style.height = `${textarea.scrollHeight}px`;
}

export function PageEditor({ pageId }: { pageId: string }) {
	const queryClient = useQueryClient();
	const pageQuery = useQuery(getPageQueryOptions(pageId));
	const updatePageMutation = useMutation(updatePageMutationOptions());
	// Viewers get a read-only surface; the server denies their writes anyway,
	// but the UI must not pretend edits will stick.
	const readOnly = !useCanEditWorkspace();
	// Cursor identity shown to collaborators when Liveblocks is configured.
	const currentUser = useCurrentUser();
	const collabUser = currentUser
		? {
				name: currentUser.name || currentUser.email || "Member",
				color: cursorColorFor(currentUser.id),
			}
		: undefined;
	// One shared room per page carries both the document and the title.
	const collabSession = useCollabSession(pageRoomId(pageId));
	const collabRoom =
		collabSession.status === "ready" ? collabSession.room : null;
	const { sharedTitle, pushTitle } = useSharedTitle(
		collabRoom,
		pageQuery.data?.title ?? null,
	);

	const [title, setTitle] = useState<string | null>(null);
	const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
	const titleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const titleDraftRef = useRef<string | null>(null);
	const titleSavePromiseRef = useRef<Promise<string | null> | null>(null);
	// Bumped when a save is rejected as stale: refetches the doc and remounts
	// the editor on the newer version instead of clobbering it.
	const [reloadCount, setReloadCount] = useState(0);
	const [editorFocusRequest, setEditorFocusRequest] = useState(0);
	const [conflictNotice, setConflictNotice] = useState(false);
	const conflictTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Reset local title state when navigating between pages.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on page change
	useEffect(() => {
		setTitle(null);
		setPageSaveState("saved");
	}, [pageId]);

	// Arriving at a page we just created: put the caret in its empty title.
	const pageLoaded = pageQuery.data != null;
	useEffect(() => {
		if (!pageLoaded || !consumeTitleFocus(pageId)) return;
		const input = titleInputRef.current;
		if (!input) return;
		input.focus({ preventScroll: true });
		input.setSelectionRange(input.value.length, input.value.length);
		releaseTitleKeyboardPrime();
	}, [pageId, pageLoaded]);

	// A collaborator renamed the page: refresh the sidebar/breadcrumb lists
	// (their PATCH already persisted it). Debounced — remote keystrokes
	// arrive one by one.
	const sidebarRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (sharedTitle === null) return;
		if (sidebarRefreshRef.current) clearTimeout(sidebarRefreshRef.current);
		sidebarRefreshRef.current = setTimeout(() => {
			invalidatePages(queryClient);
		}, 1000);
	}, [sharedTitle, queryClient]);

	// Local typing wins while in flight; otherwise the shared live title;
	// otherwise the database copy.
	const shownTitle = title ?? sharedTitle ?? pageQuery.data?.title ?? "";
	useLayoutEffect(() => {
		resizeTitleTextarea(titleInputRef.current);
	});

	async function handleConflict() {
		// Refetch first so the remounted editor initializes from the newer doc.
		await invalidatePage(queryClient, pageId);
		setReloadCount((count) => count + 1);
		setConflictNotice(true);
		if (conflictTimeoutRef.current) clearTimeout(conflictTimeoutRef.current);
		conflictTimeoutRef.current = setTimeout(
			() => setConflictNotice(false),
			5000,
		);
	}

	if (pageQuery.isPending) {
		return <PageEditorSkeleton />;
	}

	if (pageQuery.isError || !pageQuery.data) {
		return (
			<div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10 text-muted-foreground">
				<p className="px-0 md:px-[54px]">This page could not be loaded.</p>
			</div>
		);
	}

	const page = pageQuery.data;

	function handleTitleChange(next: string) {
		const normalized = normalizeTitleInput(next);
		setTitle(normalized);
		titleDraftRef.current = normalized;
		// Collaborators see every keystroke; the database write is debounced.
		pushTitle(normalized);
		if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
		titleTimeoutRef.current = setTimeout(() => {
			titleTimeoutRef.current = null;
			void saveTitle(normalized);
		}, TITLE_SAVE_DELAY_MS);
	}

	function saveTitle(next: string): Promise<string | null> {
		let promise: Promise<string | null>;
		promise = updatePageMutation
			.mutateAsync({ path: { id: pageId }, body: { title: next } })
			.then(
				(result) => {
					// Write the saved title into the cache BEFORE handing display
					// back to it — otherwise the input snaps back to the stale
					// cached title (e.g. "Untitled" on a fresh page).
					setPageTitleInCache(
						queryClient,
						pageId,
						result.title,
						result.updatedAt,
					);
					invalidatePages(queryClient);
					if (titleDraftRef.current === next) {
						titleDraftRef.current = null;
						setTitle((current) => (current === next ? null : current));
					}
					return result.updatedAt;
				},
				() => null,
			)
			.finally(() => {
				if (titleSavePromiseRef.current === promise) {
					titleSavePromiseRef.current = null;
				}
			});
		titleSavePromiseRef.current = promise;
		return promise;
	}

	async function flushTitleSave(): Promise<string | null> {
		let pendingTitle: string | null = null;
		if (titleTimeoutRef.current) {
			clearTimeout(titleTimeoutRef.current);
			titleTimeoutRef.current = null;
			pendingTitle = titleDraftRef.current;
		}

		if (titleSavePromiseRef.current) {
			const updatedAt = await titleSavePromiseRef.current;
			if (pendingTitle === null) return updatedAt;
		}

		return pendingTitle !== null ? saveTitle(pendingTitle) : null;
	}

	function handleTitleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key !== "Enter") return;

		event.preventDefault();
		if (
			event.shiftKey ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			readOnly
		) {
			return;
		}
		setEditorFocusRequest((count) => count + 1);
	}

	return (
		<div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10">
			{/* BlockNote insets its content 54px (.bn-editor padding-inline) to
			    make a gutter for the block controls; pad the title and its icon
			    to the same column so they align with block text, Notion-style. */}
			<div className="group/header">
				<div
					className={cn(
						"mb-1 px-0 md:px-[54px]",
						readOnly && "pointer-events-none",
					)}
				>
					<PageIconButton pageId={pageId} icon={page.icon} />
				</div>
				<div className="mb-2 px-0 md:px-[54px]">
					<textarea
						ref={titleInputRef}
						className="keyboard-focus-ring block max-h-none min-h-[2.25rem] w-full resize-none overflow-hidden rounded-md border-none bg-transparent font-bold text-3xl leading-tight outline-none placeholder:text-muted-foreground/60"
						value={shownTitle}
						placeholder="Untitled"
						readOnly={readOnly}
						rows={1}
						wrap="soft"
						onChange={(event) => {
							handleTitleChange(event.target.value);
							resizeTitleTextarea(event.currentTarget);
						}}
						onKeyDown={handleTitleKeyDown}
						aria-label="Page title"
					/>
				</div>
			</div>
			{conflictNotice ? (
				<p className="mb-2 px-0 text-muted-foreground text-xs md:px-[54px]">
					This page was updated elsewhere — reloaded with the latest version.
				</p>
			) : null}
			{collabSession.status === "connecting" ? (
				<div className="py-2" aria-busy>
					<ReadOnlyEditor content={page.content} />
				</div>
			) : (
				<HaunterEditor
					key={`${pageId}:${reloadCount}`}
					pageId={pageId}
					workspaceId={page.workspaceId}
					initialContent={page.content}
					contentUpdatedAt={page.contentUpdatedAt}
					editable={!readOnly}
					collab={collabRoom}
					collabUser={collabUser}
					focusRequest={editorFocusRequest}
					currentUserId={currentUser?.id ?? null}
					flushMetadataSave={flushTitleSave}
					onSaveStateChange={setPageSaveState}
					onConflict={handleConflict}
				/>
			)}
			{/* Same 54px inset as the editor content column. */}
			<div className="px-0 md:px-[54px]">
				<Backlinks pageId={pageId} />
			</div>
		</div>
	);
}
