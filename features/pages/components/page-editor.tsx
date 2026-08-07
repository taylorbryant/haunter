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
import { userErrorMessage } from "@/client/error-feedback";
import { useCurrentUser } from "@/components/app-session-provider";
import { Button } from "@/components/ui/button";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	consumeTitleFocus,
	releaseTitleKeyboardPrime,
} from "@/features/pages/client/new-page-focus";
import {
	getPageQueryOptions,
	invalidatePages,
	recordPageViewMutationOptions,
	setPageTitleInCache,
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
import {
	PAGE_TITLE_MAX_LENGTH,
	PAGE_TITLE_TOO_LONG_MESSAGE,
} from "@/features/pages/schemas";
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

const TITLE_SAVE_DELAY_MS = 500;

type TitleDraft = {
	value: string;
	save: () => Promise<string | null>;
};
type TitleSaveQueue = LatestSaveQueue<TitleDraft, string | null>;

const titleSaveQueues = createLatestSaveQueueStore<TitleDraft, string | null>();

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
	const pageQuery = useQuery(getPageQueryOptions(pageId));
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
	const readOnly = !useCanEditWorkspace();
	const currentUser = useCurrentUser();

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
	// title flusher mounted at this level covers the dynamically loaded editor
	// fallback and ordinary navigation cleanup.
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

	// Local typing wins while in flight; SQLite-backed query data is otherwise
	// authoritative and workspace events refresh it after remote changes.
	const shownTitle =
		title ?? titleQueue.pending?.value ?? pageQuery.data?.title ?? "";
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
			<HaunterEditor
				key={`${currentUser?.id ?? "anonymous"}:${pageId}`}
				pageId={pageId}
				workspaceId={page.workspaceId}
				initialContent={page.content}
				contentUpdatedAt={page.contentUpdatedAt}
				editable={!readOnly}
				focusRequest={editorFocusRequest}
				currentUserId={currentUser?.id ?? null}
				onSaveStateChange={setPageSaveState}
			/>
			{/* Same 54px inset as the editor content column. */}
			<div className="px-0 md:px-[54px]">
				<Backlinks pageId={pageId} />
			</div>
		</div>
	);
}
