"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { userErrorMessage } from "@/client/error-feedback";
import { markLoadStage, measureLoadStage } from "@/client/load-performance";
import { useCurrentUser } from "@/components/app-session-provider";
import { Button } from "@/components/ui/button";
import {
	type CollabRoom,
	canWriteToCollabRoom,
	useCollabSession,
	waitForCollabPersistence,
} from "@/features/collab/client/session";
import { cursorColorFor, documentRoomId } from "@/features/collab/lib/room";
import { queueMaterialization } from "@/features/documents/client/materialization";
import {
	activePageGeneration,
	PAGE_META_NAME,
} from "@/features/documents/model";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	consumeTitleFocus,
	releaseTitleKeyboardPrime,
} from "@/features/pages/client/new-page-focus";
import {
	getPageBootstrapQueryOptions,
	invalidatePages,
	recordPageViewMutationOptions,
	setPageTitleInCache,
	setSharedPageTitleInCache,
	syncRecordedPageViewInNavigationCache,
	updatePageMutationOptions,
} from "@/features/pages/client/queries";
import {
	createLatestSaveQueueStore,
	drainLatestSaveQueue,
	type LatestSaveQueue,
	registerPageSaveFlusher,
	setPageSaveState,
} from "@/features/pages/client/save-state";
import { useSharedTitle } from "@/features/pages/client/use-shared-title";
import {
	PAGE_TITLE_MAX_LENGTH,
	PAGE_TITLE_TOO_LONG_MESSAGE,
} from "@/features/pages/schemas";
import { cn } from "@/lib/utils";
import { Backlinks } from "./backlinks";
import { pageEditorBodyMode } from "./page-editor-body-mode";
import { EditorBodySkeleton, PageEditorSkeleton } from "./page-editor-skeleton";
import { PageIconButton } from "./page-icon-picker";
import { createRetryableModuleLoader } from "./retryable-module-loader";

type HaunterEditorComponent =
	typeof import("./editor/haunter-editor")["default"];

const haunterEditorLoader = createRetryableModuleLoader<HaunterEditorComponent>(
	() => import("./editor/haunter-editor").then((module) => module.default),
);

function useHaunterEditorComponent(pageId: string) {
	const [component, setComponent] = useState<HaunterEditorComponent | null>(
		() => haunterEditorLoader.loaded,
	);
	const [loadError, setLoadError] = useState(false);
	const [attempt, setAttempt] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt is an explicit retry signal for a rejected dynamic import
	useEffect(() => {
		let active = true;
		const scope = `page:${pageId}`;
		markLoadStage(scope, "editor-module-start");
		void haunterEditorLoader.load().then(
			(loaded) => {
				if (!active) return;
				markLoadStage(scope, "editor-module-ready");
				measureLoadStage(
					scope,
					"editor-module-duration",
					"editor-module-start",
					"editor-module-ready",
				);
				setComponent(() => loaded);
				setLoadError(false);
			},
			() => {
				if (active) setLoadError(true);
			},
		);
		return () => {
			active = false;
		};
	}, [attempt, pageId]);

	const retry = useCallback(() => {
		setLoadError(false);
		setAttempt((current) => current + 1);
	}, []);

	return { component, loadError, retry };
}

// Used only as an explicit read-only fallback when the authoritative room is
// unavailable. It is not part of the normal loading path.
const ReadOnlyEditor = dynamic(() => import("./editor/read-only-editor"), {
	ssr: false,
	loading: () => <EditorBodySkeleton />,
});

const TITLE_SAVE_DELAY_MS = 500;

type TitleDraft = {
	value: string;
	save: () => Promise<string | null>;
};
type TitleSaveQueue = LatestSaveQueue<TitleDraft, string | null>;

const titleSaveQueues = createLatestSaveQueueStore<TitleDraft, string | null>();

function useDocumentGeneration(room: CollabRoom | null): string | null {
	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			if (!room) return () => {};
			const meta = room.doc.getMap<unknown>(PAGE_META_NAME);
			meta.observe(onStoreChange);
			return () => meta.unobserve(onStoreChange);
		},
		[room],
	);
	const getSnapshot = useCallback(
		() => (room ? activePageGeneration(room.doc) : null),
		[room],
	);
	return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

function serverTitleSaveQueue(pageId: string): TitleSaveQueue {
	return { key: pageId, pending: null, timeout: null, inFlight: null };
}

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
	const pageQuery = useQuery(getPageBootstrapQueryOptions(pageId));
	const updatePageMutation = useMutation({
		...updatePageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const recordViewMutation = useMutation({
		...recordPageViewMutationOptions(),
		meta: { errorMode: "silent" },
	});
	// Viewers get a read-only surface; the server denies their writes anyway,
	// but the UI must not pretend edits will stick.
	const workspaceReadOnly = !useCanEditWorkspace();
	// Cursor identity shown to collaborators in the authoritative Liveblocks room.
	const currentUser = useCurrentUser();
	const collabUser = currentUser
		? {
				name: currentUser.name || currentUser.email || "Member",
				color: cursorColorFor(currentUser.id),
			}
		: undefined;
	// One shared room per page carries both the document and the title.
	const collabSession = useCollabSession(
		documentRoomId("page", pageId),
		currentUser?.id ?? null,
		{
			cacheEpoch: pageQuery.data?.documentCacheEpoch,
			allowLocalReady: !workspaceReadOnly,
		},
	);
	const collabRoom =
		collabSession.status === "ready" ? collabSession.room : null;
	const readOnly = !canWriteToCollabRoom(collabRoom, !workspaceReadOnly);
	const {
		component: CollaborativeEditor,
		loadError: editorLoadError,
		retry: retryEditorLoad,
	} = useHaunterEditorComponent(pageId);
	const documentGeneration = useDocumentGeneration(collabRoom);
	const { sharedTitle, pushTitle } = useSharedTitle(
		collabRoom,
		documentGeneration,
	);

	const [title, setTitle] = useState<string | null>(null);
	const [titleError, setTitleError] = useState<string | null>(null);
	const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
	// Browser queues are shared across remounts. Server renders use an isolated
	// empty queue so request-scoped page state is never retained in module state.
	// Viewers also stay isolated because they never register a writer that could
	// retain and later evict a browser queue.
	const titleQueue =
		typeof window === "undefined" || readOnly
			? serverTitleSaveQueue(pageId)
			: titleSaveQueues.get(pageId);
	const activePageIdRef = useRef(pageId);
	activePageIdRef.current = pageId;
	const [editorFocusRequest, setEditorFocusRequest] = useState(0);
	const recordedViewPageIdRef = useRef<string | null>(null);
	const bootstrapPageIdRef = useRef<string | null>(null);
	const interactivePageIdRef = useRef<string | null>(null);

	useEffect(() => {
		markLoadStage(`page:${pageId}`, "shell-mounted");
	}, [pageId]);

	useEffect(() => {
		if (!pageQuery.data || bootstrapPageIdRef.current === pageId) return;
		bootstrapPageIdRef.current = pageId;
		markLoadStage(`page:${pageId}`, "bootstrap-ready");
		measureLoadStage(
			`page:${pageId}`,
			"intent-to-bootstrap",
			"navigation-intent",
			"bootstrap-ready",
		);
	}, [pageId, pageQuery.data]);

	useEffect(() => {
		if (
			!pageQuery.data ||
			collabSession.status !== "ready" ||
			CollaborativeEditor === null ||
			interactivePageIdRef.current === pageId
		) {
			return;
		}
		interactivePageIdRef.current = pageId;
		markLoadStage(`page:${pageId}`, "editor-interactive");
		measureLoadStage(
			`page:${pageId}`,
			"shell-to-interactive",
			"shell-mounted",
			"editor-interactive",
		);
		measureLoadStage(
			`page:${pageId}`,
			"intent-to-interactive",
			"navigation-intent",
			"editor-interactive",
		);
	}, [CollaborativeEditor, collabSession.status, pageId, pageQuery.data]);

	// Reset local title state when navigating between pages.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on page change
	useEffect(() => {
		setTitle(null);
		setTitleError(null);
		setPageSaveState("saved");
		return () => {
			if (titleQueue.timeout) clearTimeout(titleQueue.timeout);
			titleQueue.timeout = null;
		};
	}, [pageId]);

	// Arriving at a page we just created: put the caret in its empty title.
	const pageLoaded = pageQuery.data != null;
	useEffect(() => {
		const page = pageQuery.data;
		if (!page || recordedViewPageIdRef.current === page.id) return;
		recordedViewPageIdRef.current = page.id;
		void recordViewMutation
			.mutateAsync({ path: { id: page.id }, body: {} })
			.then(({ lastViewedAt }) =>
				syncRecordedPageViewInNavigationCache(
					queryClient,
					page.workspaceId,
					page,
					lastViewedAt,
				),
			)
			.catch(() => {
				// Allow a later remount to retry; navigation history must never
				// interfere with loading or editing the page.
				if (recordedViewPageIdRef.current === page.id) {
					recordedViewPageIdRef.current = null;
				}
			});
	}, [pageQuery.data, queryClient, recordViewMutation.mutateAsync]);

	useEffect(() => {
		if (!pageLoaded || !consumeTitleFocus(pageId)) return;
		const input = titleInputRef.current;
		if (!input) return;
		input.focus({ preventScroll: true });
		input.setSelectionRange(input.value.length, input.value.length);
		releaseTitleKeyboardPrime();
	}, [pageId, pageLoaded]);

	// Metadata and document saves are independent registrations. Keeping the
	// title flusher mounted at this level covers collaboration startup, the
	// dynamically loaded editor fallback, and ordinary navigation cleanup.
	// biome-ignore lint/correctness/useExhaustiveDependencies: capture one page-scoped flusher until this page changes
	useEffect(() => {
		if (readOnly) return;
		const releaseQueue = titleSaveQueues.retain(titleQueue);
		const flush = flushTitleSave;
		const pending = titleQueue.pending;
		if (pending) {
			// A queue can outlive the component that created its current draft.
			// Route retries and errors through the newly mounted editor from now on.
			pending.save = () => saveTitle(pending);
			void flush();
		}
		const unregister = registerPageSaveFlusher(pageId, flush);
		return () => {
			unregister();
			releaseQueue();
			void flush().finally(() => titleSaveQueues.evictIfIdle(titleQueue));
		};
	}, [pageId, readOnly]);

	// The shared title is authoritative, so project both local and remote edits
	// directly into the sidebar and navigation caches. Refetching here can race
	// asynchronous SQLite materialization and restore the previous title.
	useEffect(() => {
		if (sharedTitle === null) return;
		setSharedPageTitleInCache(queryClient, pageId, sharedTitle);
	}, [sharedTitle, queryClient, pageId]);

	// Local typing wins while in flight; otherwise the shared live title;
	// otherwise the database copy.
	const shownTitle =
		title ??
		titleQueue.pending?.value ??
		sharedTitle ??
		pageQuery.data?.title ??
		"";
	useLayoutEffect(() => {
		resizeTitleTextarea(titleInputRef.current);
	});

	if (pageQuery.isPending) {
		return <PageEditorSkeleton />;
	}

	if (!pageQuery.data) {
		return (
			<div className="mx-auto w-full max-w-4xl space-y-3 px-4 py-6 text-muted-foreground md:px-8 md:py-10">
				<p className="px-0 md:px-[54px]">This page could not be loaded.</p>
				<div className="px-0 md:px-[54px]">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void pageQuery.refetch()}
					>
						Try again
					</Button>
				</div>
			</div>
		);
	}

	const page = pageQuery.data;
	const bodyMode = pageEditorBodyMode(
		collabSession.status,
		CollaborativeEditor !== null,
		editorLoadError,
	);

	function handleTitleChange(next: string) {
		const normalized = normalizeTitleInput(next);
		let draft: TitleDraft;
		draft = {
			value: normalized,
			save: () => saveTitle(draft),
		};
		setTitleError(
			normalized.length > PAGE_TITLE_MAX_LENGTH
				? PAGE_TITLE_TOO_LONG_MESSAGE
				: null,
		);
		setTitle(normalized);
		titleQueue.pending = draft;
		// Collaborators see every keystroke; the database write is debounced.
		pushTitle(normalized);
		if (titleQueue.timeout) clearTimeout(titleQueue.timeout);
		titleQueue.timeout = setTimeout(() => {
			titleQueue.timeout = null;
			void draft.save();
		}, TITLE_SAVE_DELAY_MS);
	}

	function saveTitle(draft: TitleDraft): Promise<string | null> {
		const next = draft.value;
		if (next.length > PAGE_TITLE_MAX_LENGTH) {
			setTitleError(PAGE_TITLE_TOO_LONG_MESSAGE);
			return Promise.resolve(null);
		}
		// Preserve typing order when a slow request overlaps the next debounce.
		// Without this queue, an older response can arrive last and overwrite the
		// newer title in both the database and client cache.
		const savedPageId = titleQueue.key;
		const previousSave = titleQueue.inFlight;
		if (collabRoom) {
			const request = async () => {
				if (!(await waitForCollabPersistence(collabRoom))) {
					throw new Error("The shared title did not finish synchronizing.");
				}
				await queueMaterialization("page", savedPageId);
				return new Date().toISOString();
			};
			let promise: Promise<string | null>;
			promise = (previousSave ? previousSave.then(request) : request())
				.then((savedAt) => {
					const isLatestDraft = titleQueue.pending === draft;
					const isActiveDraft =
						activePageIdRef.current === savedPageId && isLatestDraft;
					if (isLatestDraft) {
						titleQueue.pending = null;
						setPageTitleInCache(queryClient, savedPageId, next, savedAt);
					}
					if (isActiveDraft) {
						setTitleError(null);
						setTitle((current) => (current === next ? null : current));
					}
					return savedAt;
				})
				.catch((error) => {
					if (
						activePageIdRef.current === savedPageId &&
						titleQueue.pending === draft
					) {
						setTitleError(
							userErrorMessage(error, "The page title could not be saved."),
						);
					}
					return null;
				})
				.finally(() => {
					if (titleQueue.inFlight === promise) titleQueue.inFlight = null;
					titleSaveQueues.evictIfIdle(titleQueue);
				});
			titleQueue.inFlight = promise;
			return promise;
		}
		const request = () =>
			updatePageMutation.mutateAsync({
				path: { id: savedPageId },
				body: { title: next },
			});
		let promise: Promise<string | null>;
		promise = (previousSave ? previousSave.then(request) : request())
			.then(
				(result) => {
					const isLatestDraft = titleQueue.pending === draft;
					const isActiveDraft =
						activePageIdRef.current === savedPageId && isLatestDraft;
					if (isActiveDraft) setTitleError(null);
					// Write the saved title into the cache BEFORE handing display
					// back to it — otherwise the input snaps back to the stale
					// cached title (e.g. "Untitled" on a fresh page).
					setPageTitleInCache(
						queryClient,
						savedPageId,
						result.title,
						result.updatedAt,
					);
					void invalidatePages(queryClient);
					if (isLatestDraft) {
						titleQueue.pending = null;
					}
					if (isActiveDraft) {
						setTitle((current) => (current === next ? null : current));
					}
					return result.updatedAt;
				},
				(error) => {
					if (
						activePageIdRef.current === savedPageId &&
						titleQueue.pending === draft
					) {
						setTitleError(
							userErrorMessage(error, "The page title could not be saved."),
						);
					}
					return null;
				},
			)
			.finally(() => {
				if (titleQueue.inFlight === promise) {
					titleQueue.inFlight = null;
				}
				titleSaveQueues.evictIfIdle(titleQueue);
			});
		titleQueue.inFlight = promise;
		return promise;
	}

	async function flushTitleSave(): Promise<boolean> {
		return drainLatestSaveQueue({
			clearPendingTimer: () => {
				if (titleQueue.timeout) {
					clearTimeout(titleQueue.timeout);
					titleQueue.timeout = null;
				}
			},
			getInFlightSave: () =>
				titleQueue.inFlight?.then((savedAt) => savedAt !== null) ?? null,
			getPendingValue: () => titleQueue.pending,
			save: async (draft) => (await draft.save()) !== null,
		});
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
						maxLength={PAGE_TITLE_MAX_LENGTH}
						rows={1}
						wrap="soft"
						onChange={(event) => {
							handleTitleChange(event.target.value);
							resizeTitleTextarea(event.currentTarget);
						}}
						onKeyDown={handleTitleKeyDown}
						aria-label="Page title"
						aria-invalid={titleError ? true : undefined}
						aria-describedby={titleError ? "page-title-error" : undefined}
					/>
					{titleError ? (
						<div
							id="page-title-error"
							role="alert"
							className="mt-2 flex items-center gap-2 text-destructive text-sm"
						>
							<span className="flex-1">{titleError}</span>
							{shownTitle.length <= PAGE_TITLE_MAX_LENGTH ? (
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={updatePageMutation.isPending}
									onClick={() => {
										const draft = titleQueue.pending;
										if (draft) void draft.save();
									}}
								>
									Retry
								</Button>
							) : null}
						</div>
					) : null}
				</div>
			</div>
			{bodyMode === "loading" ? (
				<div aria-busy="true">
					<EditorBodySkeleton />
				</div>
			) : bodyMode === "fallback" ? (
				<ReadOnlyEditor content={page.content} />
			) : CollaborativeEditor && collabSession.status === "ready" ? (
				<CollaborativeEditor
					key={`${pageId}:${documentGeneration ?? "pending"}:${collabSession.room.cacheEpoch ?? "remote"}`}
					pageId={pageId}
					workspaceId={page.workspaceId}
					editable={!readOnly}
					collab={collabSession.room}
					collabGeneration={documentGeneration}
					collabUser={collabUser}
					focusRequest={editorFocusRequest}
					currentUserId={currentUser?.id ?? null}
					onSaveStateChange={setPageSaveState}
				/>
			) : null}
			{collabSession.status === "unavailable" ||
			(collabSession.status === "ready" && collabSession.remoteUnavailable) ? (
				<p className="mt-2 px-0 text-muted-foreground text-xs md:px-[54px]">
					Live editing is temporarily unavailable. This page is read-only until
					the shared document reconnects.
				</p>
			) : null}
			{editorLoadError ? (
				<div className="mt-2 flex items-center gap-2 px-0 text-muted-foreground text-xs md:px-[54px]">
					<span className="flex-1">
						The editor could not be loaded. This page is temporarily read-only.
					</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={retryEditorLoad}
					>
						Retry
					</Button>
				</div>
			) : null}
			{bodyMode !== "loading" ? (
				/* Same 54px inset as the editor content column. */
				<div className="px-0 md:px-[54px]">
					<Backlinks pageId={pageId} />
				</div>
			) : null}
		</div>
	);
}
