"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import { ContractError } from "@beignet/core/client";
import {
	type BlockNoteEditor,
	filterSuggestionItems,
	insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
	DragHandleMenu,
	FormattingToolbar,
	FormattingToolbarController,
	getDefaultReactSlashMenuItems,
	getFormattingToolbarItems,
	SideMenu,
	SideMenuController,
	SuggestionMenuController,
	useBlockNoteEditor,
	useComponentsContext,
	useCreateBlockNote,
	useExtension,
	useExtensionState,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	CheckSquareIcon,
	FilePlusIcon,
	FileTextIcon,
	LightbulbIcon,
	PenToolIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/client";
import { reportUserError, userErrorMessage } from "@/client/error-feedback";
import {
	deleteLocalDraft,
	getLocalDraft,
	hasLocalDraftHint,
	type LocalDraft,
	localDraftKey,
	putLocalDraft,
} from "@/client/local-drafts";
import { Button } from "@/components/ui/button";
import { createCanvas } from "@/features/canvases/contracts";
import { invalidateNotifications } from "@/features/notifications/client/queries";
import {
	createEditorPersistenceController,
	type EditorPersistenceController,
} from "@/features/pages/client/editor-persistence-controller";
import { focusTitleOnArrival } from "@/features/pages/client/new-page-focus";
import { registerSubpageLinkAppender } from "@/features/pages/client/open-page-content";
import {
	getPageQueryOptions,
	invalidateBacklinks,
	invalidatePages,
	listPagesQueryOptions,
	savePageContentMutationOptions,
	setPageContentInCache,
	setPageSavedAtInCache,
} from "@/features/pages/client/queries";
import {
	createInFlightSaveQueueStore,
	drainPageSaveQueue,
	type InFlightSaveQueue,
	pageDocumentSaveQueueKey,
	registerPageSaveFlusher,
} from "@/features/pages/client/save-state";
import { uploadPageImage } from "@/features/pages/client/upload";
import { createPage } from "@/features/pages/contracts";
import { containsBlockId } from "@/features/pages/lib/block-tree";
import {
	normalizeCodeBlockLanguage,
	normalizeCodeBlockLanguages,
} from "@/features/pages/lib/code-block-language";
import { isSameOrNewerContentVersion } from "@/features/pages/lib/content-version";
import { createSubpageLinkBlock } from "@/features/pages/lib/subpage-link-block";
import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";
import { useIsMobile } from "@/hooks/use-mobile";
import { getResolvedThemeColorScheme } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { EditorBodySkeleton } from "../page-editor-skeleton";
import {
	OPEN_CODE_BLOCK_DIALOG_EVENT,
	type OpenCodeBlockDialogDetail,
} from "./code-block-dialog-event";
import { CodeEditDialog } from "./code-edit-dialog";
import { useSyncEditorCodeTheme } from "./code-theme";
import { removeBlockFromSideMenu } from "./remove-block-from-side-menu";
import { editorSchema } from "./schema";
import { TaskBlockCurrentUserContext } from "./task-block";

const AUTOSAVE_DELAY_MS = 1000;

type HaunterBlockNoteEditor = BlockNoteEditor<
	(typeof editorSchema)["blockSchema"],
	(typeof editorSchema)["inlineContentSchema"],
	(typeof editorSchema)["styleSchema"]
>;

function RemoveBlockMenuItem() {
	const Components = useComponentsContext();
	const editor = useBlockNoteEditor(editorSchema);
	const sideMenu = useExtension(SideMenuExtension, { editor });
	const hoveredBlock = useExtensionState(SideMenuExtension, {
		editor,
		selector: (state) => state?.block,
	});

	if (!Components || !hoveredBlock) return null;

	return (
		<Components.Generic.Menu.Item
			className="bn-menu-item"
			onClick={() => {
				removeBlockFromSideMenu({
					hoveredBlock,
					selectedBlocks: editor.getSelection()?.blocks,
					unfreezeMenu: sideMenu.unfreezeMenu,
					removeBlocks: (blocks) => editor.removeBlocks(blocks),
				});
			}}
		>
			Delete
		</Components.Generic.Menu.Item>
	);
}

function FormattingToolbarWithoutColors() {
	return (
		<FormattingToolbar>
			{getFormattingToolbarItems().filter(
				(item) => item.key !== "colorStyleButton",
			)}
		</FormattingToolbar>
	);
}

function normalizeEditorCodeBlockLanguages(editor: HaunterBlockNoteEditor) {
	const visit = (blocks: BlockJson[]) => {
		for (const block of blocks) {
			if (block.type === "codeBlock") {
				const currentLanguage =
					typeof block.props.language === "string" ? block.props.language : "";
				const language = normalizeCodeBlockLanguage(currentLanguage);
				if (language !== currentLanguage) {
					editor.updateBlock(block.id, { props: { language } });
				}
			}
			visit(block.children);
		}
	};

	visit(editor.document as unknown as BlockJson[]);
}

function focusBlockContentOnNextFrame(
	editor: HaunterBlockNoteEditor,
	blockId: string,
) {
	requestAnimationFrame(() => {
		if (!editor.getBlock(blockId)) return;
		editor.setTextCursorPosition(blockId, "start");
		editor.focus();
	});
}

function getSlashMenuItems(
	editor: HaunterBlockNoteEditor,
	query: string,
	page: {
		pageId: string;
		workspaceId: string;
		currentUserId: string | null;
		onSubpageCreated: (created: PageMeta) => void;
	},
) {
	const taskItem = {
		title: "Task",
		subtext: "A to-do that also shows up in Tasks",
		aliases: ["task", "todo", "checkbox", "check"],
		group: "Basic blocks",
		icon: <CheckSquareIcon className="size-4.5" />,
		onItemClick: () => {
			const insertedTask = insertOrUpdateBlockForSlashMenu(editor, {
				type: "task",
				props: page.currentUserId ? { assignee: page.currentUserId } : {},
			});
			if (page.currentUserId) {
				editor.updateBlock(insertedTask, {
					props: { ...insertedTask.props, assignee: page.currentUserId },
				});
			}
			focusBlockContentOnNextFrame(editor, insertedTask.id);
		},
	};

	const canvasItem = {
		title: "Canvas",
		subtext: "An embedded tldraw drawing canvas",
		aliases: ["canvas", "draw", "drawing", "sketch", "tldraw", "excalidraw"],
		group: "Basic blocks",
		icon: <PenToolIcon className="size-4.5" />,
		onItemClick: async () => {
			try {
				// Create the row first so the block never points at a missing canvas.
				const canvas = await apiClient.endpoint(createCanvas).call({
					body: { workspaceId: page.workspaceId, pageId: page.pageId },
				});
				insertOrUpdateBlockForSlashMenu(editor, {
					type: "canvas",
					props: { canvasId: canvas.id },
				});
			} catch (error) {
				reportUserError(error, "The canvas could not be created.");
			}
		},
	};

	const calloutItem = {
		title: "Callout",
		subtext: "A highlighted box for notes and tips",
		aliases: ["callout", "note", "info", "tip", "warning", "aside"],
		group: "Basic blocks",
		icon: <LightbulbIcon className="size-4.5" />,
		onItemClick: () => {
			insertOrUpdateBlockForSlashMenu(editor, { type: "callout" });
		},
	};

	const pageItem = {
		title: "Page",
		subtext: "Create a subpage and link it here",
		aliases: ["page", "subpage", "note", "doc"],
		group: "Basic blocks",
		icon: <FilePlusIcon className="size-4.5" />,
		onItemClick: async () => {
			try {
				// Create the row first so the block never points at a missing page.
				const created = await apiClient.endpoint(createPage).call({
					body: {
						workspaceId: page.workspaceId,
						parentPageId: page.pageId,
						title: "",
						appendToParentContent: false,
					},
				});
				insertOrUpdateBlockForSlashMenu(editor, {
					type: "pageLink",
					props: { pageId: created.id, workspaceId: page.workspaceId },
				});
				page.onSubpageCreated(created);
			} catch (error) {
				reportUserError(error, "The subpage could not be created.");
			}
		},
	};

	// Splice the custom items in right after the last "Basic blocks" entry so
	// the menu keeps one contiguous group (duplicate group headers break keys).
	const items = [...getDefaultReactSlashMenuItems(editor)];
	const lastBasic = items.findLastIndex(
		(item) => "group" in item && item.group === "Basic blocks",
	);
	items.splice(
		lastBasic === -1 ? items.length : lastBasic + 1,
		0,
		pageItem,
		taskItem,
		calloutItem,
		canvasItem,
	);

	return Promise.resolve(filterSuggestionItems(items, query));
}

export type SaveState = "saved" | "pending" | "saving" | "error";

type DocumentSaveOutcome =
	| { status: "saved"; contentUpdatedAt: string }
	| { status: "conflict"; content: BlockJson[] }
	| { status: "error"; error: unknown; retryWithNewerContent: boolean };

type PageContentConflict = {
	content: BlockJson[];
};

type PageRecoveryDraft = LocalDraft<BlockJson[]>;

function cloneDocument(content: BlockJson[]): BlockJson[] {
	return structuredClone(content);
}

const documentSaveQueues = createInFlightSaveQueueStore<DocumentSaveOutcome>();

type HaunterEditorProps = {
	pageId: string;
	workspaceId: string;
	initialContent: BlockJson[];
	/** Document-only optimistic-concurrency token. */
	contentUpdatedAt?: string;
	editable?: boolean;
	/** Incremented by the owner when focus should move from the title to body. */
	focusRequest?: number;
	/** Current signed-in user, used for same-user authoring defaults. */
	currentUserId?: string | null;
	onSaveStateChange?: (state: SaveState) => void;
};

type MountedHaunterEditorProps = HaunterEditorProps & {
	initialRecoveryDraft: PageRecoveryDraft | null;
};

export default function HaunterEditor(props: HaunterEditorProps) {
	const [mounted, setMounted] = useState(false);
	const [recoveryDraft, setRecoveryDraft] = useState<
		PageRecoveryDraft | null | undefined
	>(undefined);

	// Keep the editor in the route bundle, but do not render BlockNote until the
	// browser is mounted because one of its hooks dereferences `window`.
	useEffect(() => setMounted(true), []);

	const recoveryKey = props.currentUserId
		? localDraftKey(props.currentUserId, "page", props.pageId)
		: null;
	const shouldLoadRecoveryDraft =
		mounted && recoveryKey !== null && hasLocalDraftHint(recoveryKey);
	useEffect(() => {
		if (!shouldLoadRecoveryDraft || !recoveryKey) return;
		let active = true;
		void getLocalDraft<BlockJson[]>(recoveryKey)
			.then((draft) => {
				if (!active) return;
				if (draft && draft.workspaceId !== props.workspaceId) {
					setRecoveryDraft(null);
					void deleteLocalDraft(recoveryKey).catch(() => undefined);
					return;
				}
				setRecoveryDraft(draft);
			})
			.catch(() => {
				if (active) setRecoveryDraft(null);
			});
		return () => {
			active = false;
		};
	}, [props.workspaceId, recoveryKey, shouldLoadRecoveryDraft]);

	if (!mounted || (shouldLoadRecoveryDraft && recoveryDraft === undefined)) {
		return (
			<div className="py-2">
				<EditorBodySkeleton />
			</div>
		);
	}

	return (
		<MountedHaunterEditor
			{...props}
			initialRecoveryDraft={recoveryDraft ?? null}
		/>
	);
}

function MountedHaunterEditor({
	pageId,
	workspaceId,
	initialContent,
	contentUpdatedAt,
	editable = true,
	focusRequest = 0,
	currentUserId = null,
	onSaveStateChange,
	initialRecoveryDraft,
}: MountedHaunterEditorProps) {
	const { resolvedTheme } = useTheme();
	const router = useRouter();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const isMobile = useIsMobile();
	const documentSaveQueue: InFlightSaveQueue<DocumentSaveOutcome> =
		documentSaveQueues.get(pageDocumentSaveQueueKey(pageId, currentUserId));
	const recoveryKey = currentUserId
		? localDraftKey(currentUserId, "page", pageId)
		: null;
	const initialQueuedConflict = useRef<PageContentConflict | null>(
		documentSaveQueue.lastResult?.status === "conflict"
			? { content: documentSaveQueue.lastResult.content }
			: initialRecoveryDraft
				? { content: initialRecoveryDraft.payload }
				: null,
	).current;
	const [saveState, setSaveState] = useState<SaveState>(
		initialQueuedConflict ? "error" : "saved",
	);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [hasSaveConflict, setHasSaveConflict] = useState(
		initialQueuedConflict !== null,
	);
	const saveConflictRef = useRef<PageContentConflict | null>(
		initialQueuedConflict,
	);
	const [resolvingConflict, setResolvingConflict] = useState(false);
	const [editorInitialContent] = useState(() =>
		normalizeCodeBlockLanguages(
			initialQueuedConflict?.content ?? initialContent,
		),
	);
	const normalizedRemoteContent = useMemo(
		() => normalizeCodeBlockLanguages(initialContent),
		[initialContent],
	);
	// Last document version this editor saw: metadata writes do not affect it.
	const baseUpdatedAtRef = useRef<string | null>(contentUpdatedAt ?? null);
	const saveRef = useRef<() => Promise<boolean>>(async () => true);
	const persistenceControllerRef = useRef<EditorPersistenceController | null>(
		null,
	);
	if (!persistenceControllerRef.current) {
		persistenceControllerRef.current = createEditorPersistenceController({
			initiallyDirty: initialQueuedConflict !== null,
			initialConflict: initialQueuedConflict !== null,
			autosaveDelayMs: AUTOSAVE_DELAY_MS,
			onAutosave: () => {
				void saveRef.current();
			},
		});
	}
	const persistence = persistenceControllerRef.current;

	const advanceBaseUpdatedAt = useCallback(
		(next: string | null | undefined) => {
			if (!next || !isSameOrNewerContentVersion(next, baseUpdatedAtRef.current))
				return;
			baseUpdatedAtRef.current = next;
		},
		[],
	);

	const editor = useCreateBlockNote({
		schema: editorSchema,
		uploadFile: async (file: File) => {
			try {
				return await uploadPageImage(pageId, file);
			} catch (error) {
				reportUserError(error, "The image could not be uploaded.");
				throw error;
			}
		},
		initialContent: editorInitialContent.length
			? // The server stores the document verbatim; the editor owns its shape.
				(editorInitialContent as never)
			: undefined,
	});
	useSyncEditorCodeTheme(editor, resolvedTheme);

	const appendSubpageLink = useCallback(
		(
			child: Pick<PageMeta, "id" | "workspaceId">,
			parentContentUpdatedAt: string,
		) => {
			const block = createSubpageLinkBlock(child);
			const exists = containsBlockId(
				editor.document as unknown as BlockJson[],
				block.id,
			);
			const lastBlock = editor.document.at(-1);
			if (!exists && !lastBlock) return false;

			const insert = () => {
				if (!exists && lastBlock) {
					editor.insertBlocks([block as never], lastBlock, "after");
				}
			};
			insert();
			advanceBaseUpdatedAt(parentContentUpdatedAt);
			return true;
		},
		[editor, advanceBaseUpdatedAt],
	);

	useEffect(() => {
		if (!editable) return;
		return registerSubpageLinkAppender(pageId, appendSubpageLink);
	}, [editable, pageId, appendSubpageLink]);

	// A workspace event invalidates this page after another client commits.
	// Apply a newer clean SQLite document in place. If local edits are pending,
	// the content CAS preserves the local draft and asks the user which version
	// should win instead of silently replacing either document.
	const appliedRemoteVersionRef = useRef(contentUpdatedAt ?? null);
	useEffect(() => {
		if (
			!contentUpdatedAt ||
			contentUpdatedAt === baseUpdatedAtRef.current ||
			contentUpdatedAt === appliedRemoteVersionRef.current ||
			!isSameOrNewerContentVersion(
				contentUpdatedAt,
				baseUpdatedAtRef.current,
			) ||
			persistence.dirty ||
			documentSaveQueue.inFlight
		) {
			return;
		}
		persistence.applyingRemote = true;
		editor.replaceBlocks(
			editor.document,
			(normalizedRemoteContent.length > 0
				? normalizedRemoteContent
				: [{ type: "paragraph" }]) as never,
		);
		requestAnimationFrame(() => {
			persistence.applyingRemote = false;
		});
		appliedRemoteVersionRef.current = contentUpdatedAt;
		advanceBaseUpdatedAt(contentUpdatedAt);
	}, [
		advanceBaseUpdatedAt,
		contentUpdatedAt,
		documentSaveQueue,
		editor,
		normalizedRemoteContent,
		persistence,
	]);

	useEffect(() => {
		if (!focusRequest || !editable) return;
		const firstBlock = editor.document[0];
		if (!firstBlock) return;
		focusBlockContentOnNextFrame(editor, firstBlock.id);
	}, [editor, editable, focusRequest]);

	const focusedNotificationBlockRef = useRef<string | null>(null);
	const notificationBlockId = searchParams.get("block");
	useEffect(() => {
		if (
			!notificationBlockId ||
			focusedNotificationBlockRef.current === notificationBlockId
		) {
			return;
		}
		let attempts = 0;
		let timeout: ReturnType<typeof setTimeout> | null = null;
		const focus = () => {
			if (!editor.getBlock(notificationBlockId)) {
				attempts += 1;
				if (attempts < 30) timeout = setTimeout(focus, 100);
				return;
			}
			focusedNotificationBlockRef.current = notificationBlockId;
			requestAnimationFrame(() => {
				const element = Array.from(
					document.querySelectorAll<HTMLElement>("[data-id]"),
				).find((candidate) => candidate.dataset.id === notificationBlockId);
				element?.scrollIntoView({ behavior: "smooth", block: "center" });
				if (editable) focusBlockContentOnNextFrame(editor, notificationBlockId);
			});

			// The query parameter is an arrival instruction, not persistent page state.
			const url = new URL(window.location.href);
			url.searchParams.delete("block");
			window.history.replaceState(window.history.state, "", url);
		};
		focus();
		return () => {
			if (timeout) clearTimeout(timeout);
		};
	}, [editor, editable, notificationBlockId]);

	const saveMutation = useMutation({
		...savePageContentMutationOptions(),
		meta: { errorMode: "inline" },
	});

	const reportState = useCallback(
		(state: SaveState) => {
			setSaveState(state);
			onSaveStateChange?.(state);
		},
		[onSaveStateChange],
	);

	const persistRecoveryDraft = useCallback(
		async (content: BlockJson[]) => {
			if (!currentUserId || !recoveryKey) return;
			await putLocalDraft({
				key: recoveryKey,
				userId: currentUserId,
				workspaceId,
				resourceType: "page",
				resourceId: pageId,
				baseVersion: baseUpdatedAtRef.current,
				payload: cloneDocument(content),
				status: "conflict",
				updatedAt: new Date().toISOString(),
			});
		},
		[currentUserId, pageId, recoveryKey, workspaceId],
	);

	const clearRecoveryDraft = useCallback(async () => {
		if (recoveryKey) await deleteLocalDraft(recoveryKey);
	}, [recoveryKey]);

	const preserveConflict = useCallback(
		async (content: BlockJson[], restoreEditor: boolean) => {
			const snapshot = cloneDocument(content);
			const conflict = { content: snapshot } satisfies PageContentConflict;
			saveConflictRef.current = conflict;
			persistence.hasConflict = true;
			setHasSaveConflict(true);
			documentSaveQueues.setLastResult(
				documentSaveQueue,
				{
					status: "conflict",
					content: snapshot,
				},
				{ retainWhenIdle: true },
			);
			persistence.dirty = true;
			setSaveError(null);
			setPageContentInCache(queryClient, pageId, snapshot);
			if (restoreEditor) {
				persistence.applyingRemote = true;
				editor.replaceBlocks(
					editor.document,
					(snapshot.length > 0 ? snapshot : [{ type: "paragraph" }]) as never,
				);
				requestAnimationFrame(() => {
					persistence.applyingRemote = false;
				});
			}
			reportState("error");
			try {
				await persistRecoveryDraft(snapshot);
			} catch (error) {
				setSaveError(
					userErrorMessage(
						error,
						"Your unsaved version is open, but could not be stored on this device.",
					),
				);
			}
		},
		[
			documentSaveQueue,
			editor,
			pageId,
			persistence,
			persistRecoveryDraft,
			queryClient,
			reportState,
		],
	);

	const loadLatestAfterConflict = useCallback(async () => {
		setResolvingConflict(true);
		setSaveError(null);
		try {
			const latest = await queryClient.fetchQuery({
				...getPageQueryOptions(pageId),
				staleTime: 0,
			});
			await clearRecoveryDraft().catch(() => undefined);
			persistence.applyingRemote = true;
			editor.replaceBlocks(
				editor.document,
				(latest.content.length > 0
					? latest.content
					: [{ type: "paragraph" }]) as never,
			);
			requestAnimationFrame(() => {
				persistence.applyingRemote = false;
			});
			baseUpdatedAtRef.current = latest.contentUpdatedAt;
			appliedRemoteVersionRef.current = latest.contentUpdatedAt;
			persistence.dirty = false;
			saveConflictRef.current = null;
			persistence.hasConflict = false;
			setHasSaveConflict(false);
			documentSaveQueues.clearLastResult(documentSaveQueue);
			reportState("saved");
		} catch (error) {
			setSaveError(
				userErrorMessage(error, "The latest page version could not be loaded."),
			);
			reportState("error");
		} finally {
			setResolvingConflict(false);
		}
	}, [
		clearRecoveryDraft,
		documentSaveQueue,
		editor,
		pageId,
		persistence,
		queryClient,
		reportState,
	]);

	const saveLocalAfterConflict = useCallback(async () => {
		setResolvingConflict(true);
		setSaveError(null);
		try {
			// Refresh only to obtain the current CAS token. The editor remains on
			// the preserved local document, and the recovery snapshot remains pinned
			// until every edit made during this explicit overwrite is saved.
			const latest = await queryClient.fetchQuery({
				...getPageQueryOptions(pageId),
				staleTime: 0,
			});
			baseUpdatedAtRef.current = latest.contentUpdatedAt;
			persistence.allowConflictSave = true;
			persistence.dirty = true;
			reportState("pending");
			const saved = await drainPageSaveQueue({
				clearPendingTimer: persistence.clearPendingTimer,
				hasPendingChanges: () =>
					persistence.dirty || documentSaveQueue.inFlight !== null,
				save: () => saveRef.current(),
			});
			if (saved) {
				await clearRecoveryDraft().catch(() => undefined);
				saveConflictRef.current = null;
				persistence.hasConflict = false;
				setHasSaveConflict(false);
				documentSaveQueues.clearLastResult(documentSaveQueue);
			} else if (saveConflictRef.current) {
				documentSaveQueues.setLastResult(
					documentSaveQueue,
					{
						status: "conflict",
						content: cloneDocument(saveConflictRef.current.content),
					},
					{ retainWhenIdle: true },
				);
			}
		} catch (error) {
			const content = editor.document as unknown as BlockJson[];
			await preserveConflict(content, false);
			setSaveError(
				userErrorMessage(error, "Your page version could not be saved."),
			);
		} finally {
			persistence.allowConflictSave = false;
			setResolvingConflict(false);
		}
	}, [
		documentSaveQueue,
		clearRecoveryDraft,
		editor,
		pageId,
		persistence,
		preserveConflict,
		queryClient,
		reportState,
	]);

	saveRef.current = async () => {
		const precedingSave = documentSaveQueue.inFlight;
		if (precedingSave) {
			const outcome = await precedingSave;
			if (outcome.status === "saved") {
				advanceBaseUpdatedAt(outcome.contentUpdatedAt);
				return persistence.dirty ? saveRef.current() : true;
			}
			if (outcome.status === "conflict") {
				if (!saveConflictRef.current) {
					const hasNewerLocalEdits = persistence.dirty;
					await preserveConflict(
						hasNewerLocalEdits
							? (editor.document as unknown as BlockJson[])
							: outcome.content,
						!hasNewerLocalEdits,
					);
				}
				return false;
			}
			// A newer local document supersedes the failed snapshot and can retry
			// from the same content version once the old request has settled.
			if (outcome.retryWithNewerContent) return saveRef.current();
			setSaveError(
				userErrorMessage(
					outcome.error,
					"Your page changes could not be saved.",
				),
			);
			reportState("error");
			return false;
		}
		// Conflicts require an explicit choice. Normal autosave and navigation
		// flushes must not silently overwrite the newer server document.
		if (!persistence.beginSave()) return !saveConflictRef.current;
		reportState("saving");
		const content = editor.document as unknown as BlockJson[];
		// Mirror into the cache immediately: a remount between this save and
		// the next refetch must not initialize the editor from a stale doc.
		setPageContentInCache(queryClient, pageId, content);
		let saveAgainAfterSuccess = false;
		const request = saveMutation
			.mutateAsync({
				path: { id: pageId },
				body: {
					content,
					...(baseUpdatedAtRef.current
						? { baseUpdatedAt: baseUpdatedAtRef.current }
						: {}),
				},
			})
			.then(
				(result) => {
					setSaveError(null);
					advanceBaseUpdatedAt(result.contentUpdatedAt);
					saveAgainAfterSuccess = persistence.dirty;
					if (!persistence.dirty) reportState("saved");
					setPageSavedAtInCache(
						queryClient,
						pageId,
						result.updatedAt,
						result.contentUpdatedAt,
					);
					if (result.linksChanged) {
						invalidateBacklinks(queryClient);
					}
					if (result.tasksChanged) {
						invalidateTasksWhenIdle(queryClient);
						invalidateNotifications(queryClient);
					}
					return {
						status: "saved",
						contentUpdatedAt: result.contentUpdatedAt,
					} satisfies DocumentSaveOutcome;
				},
				async (error) => {
					if (error instanceof ContractError && error.status === 409) {
						// Keep the current editor document—including any typing that
						// happened while this request was in flight—until the user
						// chooses whether the local or server version should win.
						const localContent = cloneDocument(
							editor.document as unknown as BlockJson[],
						);
						await preserveConflict(localContent, false);
						return {
							status: "conflict",
							content: localContent,
						} satisfies DocumentSaveOutcome;
					}
					const retryWithNewerContent = persistence.dirty;
					persistence.markSaveFailed();
					setSaveError(
						userErrorMessage(error, "Your page changes could not be saved."),
					);
					reportState("error");
					return {
						status: "error",
						error,
						retryWithNewerContent,
					} satisfies DocumentSaveOutcome;
				},
			);
		const run = documentSaveQueues
			.track(documentSaveQueue, request)
			.then((outcome) => {
				// A debounce can fire while the preceding request is still running.
				// Hand the newer document to a fresh request once that save succeeds.
				if (outcome.status === "saved" && saveAgainAfterSuccess) {
					void saveRef.current();
				}
				return outcome.status === "saved";
			});
		return run;
	};

	const handleChange = useCallback(() => {
		// Viewers must never autosave an editor initialized from read-only data.
		if (!editable || persistence.applyingRemote) return;
		normalizeEditorCodeBlockLanguages(editor);
		persistence.markChanged();
		if (saveConflictRef.current) {
			// Keep edits made while the conflict banner is open in the shared
			// page queue as well, so a same-page remount restores the latest local
			// draft rather than only the snapshot rejected by the server.
			const content = cloneDocument(editor.document as unknown as BlockJson[]);
			const conflict = { content } satisfies PageContentConflict;
			saveConflictRef.current = conflict;
			documentSaveQueues.setLastResult(
				documentSaveQueue,
				{
					status: "conflict",
					content,
				},
				{ retainWhenIdle: true },
			);
			void persistRecoveryDraft(content).catch((error) => {
				setSaveError(
					userErrorMessage(
						error,
						"Your unsaved version is open, but could not be stored on this device.",
					),
				);
			});
			reportState("error");
			return;
		}
		setSaveError(null);
		reportState("pending");
		persistence.scheduleAutosave();
	}, [
		documentSaveQueue,
		editable,
		editor,
		persistence,
		persistRecoveryDraft,
		reportState,
	]);

	// Retain the page-scoped coordinator through cleanup. If this editor is
	// replaced while its save is running, the replacement adopts that exact
	// result before it can persist a newer document.
	useEffect(() => {
		const releaseQueue = documentSaveQueues.retain(documentSaveQueue);
		const lastResult = documentSaveQueue.lastResult;
		if (lastResult?.status === "saved") {
			advanceBaseUpdatedAt(lastResult.contentUpdatedAt);
		} else if (lastResult?.status === "conflict") {
			void preserveConflict(lastResult.content, false);
		} else if (initialRecoveryDraft) {
			void preserveConflict(initialRecoveryDraft.payload, false);
		}
		const precedingSave = documentSaveQueue.inFlight;
		if (precedingSave) {
			let active = true;
			void precedingSave.then((outcome) => {
				if (outcome.status === "saved") {
					advanceBaseUpdatedAt(outcome.contentUpdatedAt);
				} else if (
					outcome.status === "conflict" &&
					active &&
					!saveConflictRef.current
				) {
					// The component that started the request may already be gone. The
					// replacement adopts the rejected local snapshot rather than
					// initializing from—and then overwriting it with—the server copy.
					void preserveConflict(outcome.content, true);
				}
			});
			return () => {
				active = false;
				persistence.clearPendingTimer();
				void saveRef.current().finally(releaseQueue);
			};
		}
		return () => {
			persistence.clearPendingTimer();
			void saveRef.current().finally(releaseQueue);
		};
	}, [
		advanceBaseUpdatedAt,
		documentSaveQueue,
		initialRecoveryDraft,
		persistence,
		preserveConflict,
	]);

	useEffect(() => {
		return registerPageSaveFlusher(pageId, async () => {
			return drainPageSaveQueue({
				clearPendingTimer: persistence.clearPendingTimer,
				hasPendingChanges: () =>
					persistence.dirty || documentSaveQueue.inFlight !== null,
				save: () => saveRef.current(),
			});
		});
	}, [documentSaveQueue, pageId, persistence]);

	const [codeDialogBlockId, setCodeDialogBlockId] = useState<string | null>(
		null,
	);

	useEffect(() => {
		const openCodeDialog = (event: Event) => {
			const detail = (event as CustomEvent<OpenCodeBlockDialogDetail>).detail;
			if (typeof detail?.blockId === "string") {
				setCodeDialogBlockId(detail.blockId);
			}
		};
		window.addEventListener(OPEN_CODE_BLOCK_DIALOG_EVENT, openCodeDialog);
		return () => {
			window.removeEventListener(OPEN_CODE_BLOCK_DIALOG_EVENT, openCodeDialog);
		};
	}, []);

	return (
		// On mobile, `editor-flush` drops BlockNote's 54px inline gutter so
		// content runs edge-to-edge; the block controls that live there are
		// hidden below. Driven from JS (not CSS) to share one breakpoint.
		<div className={cn("haunter-editor", isMobile && "editor-flush")}>
			{hasSaveConflict ? (
				<div
					role="alert"
					className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-sm"
				>
					<div className="min-w-0 flex-1">
						<p className="font-medium text-destructive">
							This page changed elsewhere. Your unsaved version is still open.
						</p>
						<p className="text-muted-foreground text-xs">
							Load the latest version, or save yours over the newer content.
						</p>
						{saveError ? (
							<p className="mt-1 text-destructive text-xs">{saveError}</p>
						) : null}
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={resolvingConflict}
						onClick={() => void loadLatestAfterConflict()}
					>
						Load latest
					</Button>
					<Button
						type="button"
						variant="destructive"
						size="sm"
						disabled={resolvingConflict}
						onClick={() => void saveLocalAfterConflict()}
					>
						Save my version
					</Button>
				</div>
			) : saveError ? (
				<div
					role="alert"
					className="mb-2 flex items-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-destructive text-sm"
				>
					<span className="flex-1">{saveError}</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={saveMutation.isPending}
						onClick={() => void saveRef.current()}
					>
						Retry
					</Button>
				</div>
			) : null}
			<TaskBlockCurrentUserContext.Provider value={currentUserId}>
				<BlockNoteView
					editor={editor}
					editable={editable}
					onChange={handleChange}
					theme={getResolvedThemeColorScheme(resolvedTheme)}
					formattingToolbar={false}
					slashMenu={false}
					sideMenu={false}
				>
					<FormattingToolbarController
						formattingToolbar={FormattingToolbarWithoutColors}
					/>
					<SuggestionMenuController
						triggerCharacter="/"
						getItems={(query) =>
							getSlashMenuItems(editor, query, {
								pageId,
								workspaceId,
								currentUserId,
								// Open the new subpage; the unmount flush persists the
								// parent document (with the link block) on the way out.
								onSubpageCreated: async (created) => {
									await invalidatePages(queryClient);
									focusTitleOnArrival(created.id);
									router.push(`/w/${workspaceId}/p/${created.id}`);
								},
							})
						}
					/>
					<SuggestionMenuController
						triggerCharacter="@"
						getItems={async (query) => {
							// Cache-first: the sidebar keeps this list warm.
							const pages = await queryClient.ensureQueryData(
								listPagesQueryOptions(workspaceId),
							);
							const needle = query.toLowerCase();
							return pages.items
								.filter((item) => item.id !== pageId)
								.filter((item) =>
									(item.title || "Untitled").toLowerCase().includes(needle),
								)
								.slice(0, 10)
								.map((item) => ({
									title: item.title || "Untitled",
									icon: <FileTextIcon className="size-4.5" />,
									onItemClick: () => {
										editor.insertInlineContent([
											{
												type: "mention",
												props: { pageId: item.id, workspaceId },
											},
											" ",
										]);
									},
								}));
						}}
					/>
					{/* The +/drag block controls are hidden on mobile: they're hard
				    to use on touch and their gutter is reclaimed for content. */}
					{!isMobile ? (
						<SideMenuController
							sideMenu={(props) => (
								<SideMenu
									{...props}
									dragHandleMenu={() => (
										<DragHandleMenu>
											<RemoveBlockMenuItem />
										</DragHandleMenu>
									)}
								/>
							)}
						/>
					) : null}
				</BlockNoteView>
			</TaskBlockCurrentUserContext.Provider>
			{codeDialogBlockId ? (
				<CodeEditDialog
					editor={editor}
					blockId={codeDialogBlockId}
					editable={editable}
					onClose={() => setCodeDialogBlockId(null)}
				/>
			) : null}
			<span className="sr-only" aria-live="polite">
				{saveState === "saving" || saveState === "pending"
					? "Saving"
					: saveState === "error"
						? "Save failed"
						: "Saved"}
			</span>
		</div>
	);
}
