"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { authClient } from "@/client/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { useCollabSession } from "@/features/collab/client/session";
import { cursorColorFor, pageRoomId } from "@/features/collab/lib/room";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	getPageQueryOptions,
	invalidatePage,
	invalidatePages,
	setPageTitleInCache,
	updatePageMutationOptions,
} from "@/features/pages/client/queries";
import {
	consumeTitleFocus,
	releaseTitleKeyboardPrime,
} from "@/features/pages/client/new-page-focus";
import { setPageSaveState } from "@/features/pages/client/save-state";
import { useSharedTitle } from "@/features/pages/client/use-shared-title";
import { cn } from "@/lib/utils";
import { Backlinks } from "./backlinks";
import { PageIconButton } from "./page-icon-picker";

/**
 * Body placeholder shaped like a couple of paragraphs. Uses the editor's text
 * column inset (54px on desktop, flush on mobile) so it lines up with the real
 * content, and is shared by the data-loading and editor-chunk-loading states
 * so the two skeletons look identical.
 */
function EditorBodySkeleton() {
	return (
		<div className="flex flex-col gap-3 px-0 md:px-[54px]" aria-hidden>
			<Skeleton className="h-4 w-11/12" />
			<Skeleton className="h-4 w-4/5" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="mt-5 h-4 w-3/4" />
			<Skeleton className="h-4 w-5/6" />
			<Skeleton className="h-4 w-2/5" />
		</div>
	);
}

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

export function PageEditor({ pageId }: { pageId: string }) {
	const queryClient = useQueryClient();
	const pageQuery = useQuery(getPageQueryOptions(pageId));
	const updatePageMutation = useMutation(updatePageMutationOptions());
	// Viewers get a read-only surface; the server denies their writes anyway,
	// but the UI must not pretend edits will stick.
	const readOnly = !useCanEditWorkspace();
	// Cursor identity shown to collaborators when Liveblocks is configured.
	const session = authClient.useSession();
	const collabUser = session.data
		? {
				name: session.data.user.name || session.data.user.email || "Member",
				color: cursorColorFor(session.data.user.id),
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
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	const titleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const titleDraftRef = useRef<string | null>(null);
	const titleSavePromiseRef = useRef<Promise<string | null> | null>(null);
	const [localMetadataUpdatedAt, setLocalMetadataUpdatedAt] = useState<
		string | null
	>(null);
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
		setLocalMetadataUpdatedAt(null);
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
		return (
			<div
				className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10"
				aria-hidden
			>
				<div className="mb-3 px-0 md:px-[54px]">
					<Skeleton className="size-10 rounded-lg" />
				</div>
				<div className="mb-6 px-0 md:px-[54px]">
					<Skeleton className="h-9 w-1/2 max-w-xs" />
				</div>
				<EditorBodySkeleton />
			</div>
		);
	}

	if (pageQuery.isError || !pageQuery.data) {
		return (
			<div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10 text-muted-foreground">
				<p className="px-0 md:px-[54px]">This page could not be loaded.</p>
			</div>
		);
	}

	const page = pageQuery.data;
	// Local typing wins while in flight; otherwise the shared live title;
	// otherwise the database copy.
	const shownTitle = title ?? sharedTitle ?? page.title;

	function handleTitleChange(next: string) {
		setTitle(next);
		titleDraftRef.current = next;
		// Collaborators see every keystroke; the database write is debounced.
		pushTitle(next);
		if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
		titleTimeoutRef.current = setTimeout(() => {
			titleTimeoutRef.current = null;
			void saveTitle(next);
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
					setLocalMetadataUpdatedAt(result.updatedAt);
					invalidatePages(queryClient);
					setTitle(null);
					if (titleDraftRef.current === next) {
						titleDraftRef.current = null;
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

	function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (
			event.key !== "Enter" ||
			event.shiftKey ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			readOnly
		) {
			return;
		}

		event.preventDefault();
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
					<input
						ref={titleInputRef}
						className="keyboard-focus-ring w-full rounded-md border-none bg-transparent font-bold text-3xl outline-none placeholder:text-muted-foreground/60"
						value={shownTitle}
						placeholder="Untitled"
						readOnly={readOnly}
						onChange={(event) => handleTitleChange(event.target.value)}
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
					updatedAt={page.updatedAt}
					localMetadataUpdatedAt={localMetadataUpdatedAt}
					editable={!readOnly}
					collab={collabRoom}
					collabUser={collabUser}
					focusRequest={editorFocusRequest}
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
