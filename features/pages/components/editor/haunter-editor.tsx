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
import type { Awareness } from "y-protocols/awareness";
import { apiClient } from "@/client";
import { reportUserError, userErrorMessage } from "@/client/error-feedback";
import { Button } from "@/components/ui/button";
import { createCanvas } from "@/features/canvases/contracts";
import { setCollabPresence } from "@/features/collab/client/presence-state";
import type { CollabRoom } from "@/features/collab/client/session";
import { invalidateNotifications } from "@/features/notifications/client/queries";
import { focusTitleOnArrival } from "@/features/pages/client/new-page-focus";
import { registerSubpageLinkAppender } from "@/features/pages/client/open-page-content";
import {
	invalidateBacklinks,
	invalidatePage,
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
	registerPageSaveFlusher,
} from "@/features/pages/client/save-state";
import { uploadPageImage } from "@/features/pages/client/upload";
import { createPage } from "@/features/pages/contracts";
import {
	normalizeCodeBlockLanguage,
	normalizeCodeBlockLanguages,
} from "@/features/pages/lib/code-block-language";
import {
	COLLAB_CONTENT_VERSION_KEY,
	COLLAB_SEEDED_KEY,
	COLLAB_SUBPAGE_LINKS_KEY,
	COLLAB_TASK_BLOCK_PATCHES_KEY,
	isSameOrNewerContentVersion,
	isSubpageLinkedCollabEvent,
	isTaskBlockPatchedCollabEvent,
	type SubpageLinkedCollabEvent,
} from "@/features/pages/lib/collab-document";
import {
	containsBlockId,
	reconcilePageLinkBlocks,
} from "@/features/pages/lib/reconcile-page-link-blocks";
import { createSubpageLinkBlock } from "@/features/pages/lib/subpage-link-block";
import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";
import { reconcileTaskBlockProps } from "@/features/tasks/lib/reconcile-task-block-props";
import { useIsMobile } from "@/hooks/use-mobile";
import { getResolvedThemeColorScheme } from "@/lib/themes";
import { cn } from "@/lib/utils";
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
	| { status: "conflict" }
	| { status: "error"; error: unknown };

const documentSaveQueues = createInFlightSaveQueueStore<DocumentSaveOutcome>();

type HaunterEditorProps = {
	pageId: string;
	workspaceId: string;
	initialContent: BlockJson[];
	/** Document-only optimistic-concurrency token. */
	contentUpdatedAt?: string;
	editable?: boolean;
	/**
	 * The page's synced Liveblocks room, or null for local-only editing.
	 * PageEditor owns the session lifecycle (and its connecting/fallback
	 * states) so the title can share the same doc.
	 */
	collab?: CollabRoom | null;
	/** Cursor identity shown to collaborators when collaboration is on. */
	collabUser?: { name: string; color: string };
	/** Incremented by the owner when focus should move from the title to body. */
	focusRequest?: number;
	/** Current signed-in user, used for same-user authoring defaults. */
	currentUserId?: string | null;
	onSaveStateChange?: (state: SaveState) => void;
	/** The server rejected a save as stale; the owner should reload the doc. */
	onConflict?: () => void;
};

/**
 * Publishes the other people currently in this page to the presence store;
 * the app header renders the chips (next to "Edited X ago").
 */
function PresencePublisher({ room }: { room: CollabRoom }) {
	useEffect(() => {
		const awareness = room.provider.awareness;
		const ownClientId = room.doc.clientID;
		const update = () => {
			const seen = new Map<string, { name: string; color: string }>();
			for (const [clientId, state] of awareness.getStates()) {
				if (clientId === ownClientId) continue;
				const user = (
					state as { user?: { name?: string; color?: string } } | undefined
				)?.user;
				if (user?.name) {
					seen.set(user.name, {
						name: user.name,
						color: user.color ?? "#3b82f6",
					});
				}
			}
			setCollabPresence([...seen.values()]);
		};
		awareness.on("change", update);
		update();
		return () => {
			awareness.off("change", update);
			setCollabPresence([]);
		};
	}, [room]);

	return null;
}

export default function HaunterEditor({
	pageId,
	workspaceId,
	initialContent,
	contentUpdatedAt,
	editable = true,
	collabUser,
	collab = null,
	focusRequest = 0,
	currentUserId = null,
	onSaveStateChange,
	onConflict,
}: HaunterEditorProps) {
	const { resolvedTheme } = useTheme();
	const router = useRouter();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const isMobile = useIsMobile();
	const documentSaveQueue: InFlightSaveQueue<DocumentSaveOutcome> =
		documentSaveQueues.get(pageId);
	const [saveState, setSaveState] = useState<SaveState>("saved");
	const [saveError, setSaveError] = useState<string | null>(null);
	const onConflictRef = useRef(onConflict);
	onConflictRef.current = onConflict;
	const normalizedInitialContent = useMemo(
		() => normalizeCodeBlockLanguages(initialContent),
		[initialContent],
	);
	// Last document version this editor saw: metadata writes do not affect it.
	const baseUpdatedAtRef = useRef<string | null>(contentUpdatedAt ?? null);

	const advanceBaseUpdatedAt = useCallback(
		(next: string | null | undefined) => {
			if (!next || !isSameOrNewerContentVersion(next, baseUpdatedAtRef.current))
				return;
			baseUpdatedAtRef.current = next;
		},
		[],
	);

	useEffect(() => {
		if (!collab) return;
		const meta = collab.doc.getMap<unknown>("haunter-meta");
		const advanceFromRoom = () => {
			const version = meta.get(COLLAB_CONTENT_VERSION_KEY);
			if (typeof version === "string") advanceBaseUpdatedAt(version);
		};
		meta.observe(advanceFromRoom);
		advanceFromRoom();
		return () => meta.unobserve(advanceFromRoom);
	}, [collab, advanceBaseUpdatedAt]);

	// Only the doc-level marker establishes that the shared document completed
	// its database seed. Fragment length is not authoritative because BlockNote
	// materializes an empty paragraph while binding a new document.
	const [shouldSeed] = useState(() => {
		if (!collab) return false;
		const meta = collab.doc.getMap<unknown>("haunter-meta");
		return meta.get(COLLAB_SEEDED_KEY) !== true;
	});

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
		collaboration: collab
			? {
					fragment: collab.doc.getXmlFragment("blocknote"),
					// Liveblocks bundles its own copy of y-protocols, so its
					// Awareness is a structural twin of the one BlockNote expects.
					provider: collab.provider as unknown as { awareness: Awareness },
					user: collabUser ?? { name: "Member", color: "#3b82f6" },
				}
			: undefined,
		// BlockNote rejects an empty initialContent array; with collaboration
		// the shared doc is the source of truth instead.
		initialContent:
			!collab && normalizedInitialContent.length
				? // The server stores the document verbatim; the editor owns its shape.
					(normalizedInitialContent as never)
				: undefined,
	});
	useSyncEditorCodeTheme(editor, resolvedTheme);

	const appendSubpageLink = useCallback(
		(
			child: SubpageLinkedCollabEvent["child"],
			parentContentUpdatedAt: string,
		) => {
			const meta = collab?.doc.getMap<unknown>("haunter-meta");
			if (meta && meta.get(COLLAB_SEEDED_KEY) !== true) return false;

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
			if (collab && meta) {
				collab.doc.transact(() => {
					insert();
					const current = meta.get(COLLAB_CONTENT_VERSION_KEY);
					if (
						typeof current !== "string" ||
						isSameOrNewerContentVersion(parentContentUpdatedAt, current)
					) {
						meta.set(COLLAB_CONTENT_VERSION_KEY, parentContentUpdatedAt);
					}
				});
			} else {
				insert();
			}
			advanceBaseUpdatedAt(parentContentUpdatedAt);
			return true;
		},
		[collab, editor, advanceBaseUpdatedAt],
	);

	useEffect(() => {
		if (!editable) return;
		return registerSubpageLinkAppender(pageId, appendSubpageLink);
	}, [editable, pageId, appendSubpageLink]);

	useEffect(() => {
		if (!collab || !editable) return;
		const pending = collab.doc.getMap<unknown>(COLLAB_SUBPAGE_LINKS_KEY);
		const applyPending = () => {
			for (const event of pending.values()) {
				if (!isSubpageLinkedCollabEvent(event)) continue;
				appendSubpageLink(event.child, event.parentContentUpdatedAt);
			}
		};
		pending.observe(applyPending);
		applyPending();
		return () => pending.unobserve(applyPending);
	}, [collab, editable, appendSubpageLink]);

	useEffect(() => {
		if (!collab) return;
		const pending = collab.doc.getMap<unknown>(COLLAB_TASK_BLOCK_PATCHES_KEY);
		const applyPending = () => {
			for (const candidate of pending.values()) {
				if (!isTaskBlockPatchedCollabEvent(candidate)) continue;
				if (
					contentUpdatedAt &&
					!isSameOrNewerContentVersion(
						candidate.pageContentUpdatedAt,
						contentUpdatedAt,
					)
				) {
					continue;
				}
				const block = editor.getBlock(candidate.blockId);
				if (block?.type !== "task") continue;
				const currentProps = block.props as Record<string, unknown>;
				if (
					Object.entries(candidate.props).every(
						([key, value]) => currentProps[key] === value,
					)
				) {
					continue;
				}
				editor.updateBlock(candidate.blockId, {
					props: candidate.props,
				} as never);
			}
		};
		pending.observe(applyPending);
		applyPending();
		return () => pending.unobserve(applyPending);
	}, [collab, contentUpdatedAt, editor]);

	// Seed a brand-new shared doc from the database copy exactly once.
	const seededRef = useRef(false);
	useEffect(() => {
		if (!collab || !shouldSeed || seededRef.current) return;
		seededRef.current = true;
		const meta = collab.doc.getMap<unknown>("haunter-meta");
		if (meta.get(COLLAB_SEEDED_KEY) === true) return;
		collab.doc.transact(() => {
			if (normalizedInitialContent.length > 0) {
				editor.replaceBlocks(
					editor.document,
					normalizedInitialContent as never,
				);
			}
			if (contentUpdatedAt) {
				meta.set(COLLAB_CONTENT_VERSION_KEY, contentUpdatedAt);
			}
			meta.set(COLLAB_SEEDED_KEY, true);
		});
	}, [collab, shouldSeed, contentUpdatedAt, editor, normalizedInitialContent]);

	const reconciledVersionRef = useRef<string | null>(null);
	useEffect(() => {
		if (!collab) return;
		if (reconciledVersionRef.current === contentUpdatedAt) return;
		reconciledVersionRef.current = contentUpdatedAt ?? null;

		const taskResult = reconcileTaskBlockProps(
			editor.document as unknown as BlockJson[],
			normalizedInitialContent,
		);
		const pageLinkResult = reconcilePageLinkBlocks(
			taskResult.blocks,
			normalizedInitialContent,
		);
		if (taskResult.changed || pageLinkResult.changed) {
			editor.replaceBlocks(editor.document, pageLinkResult.blocks as never);
		}
	}, [collab, contentUpdatedAt, editor, normalizedInitialContent]);

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
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dirtyRef = useRef(false);
	const saveRef = useRef<() => Promise<boolean>>(async () => true);

	const reportState = useCallback(
		(state: SaveState) => {
			setSaveState(state);
			onSaveStateChange?.(state);
		},
		[onSaveStateChange],
	);

	saveRef.current = async () => {
		const precedingSave = documentSaveQueue.inFlight;
		if (precedingSave) {
			const outcome = await precedingSave;
			if (outcome.status === "saved") {
				advanceBaseUpdatedAt(outcome.contentUpdatedAt);
				return dirtyRef.current ? saveRef.current() : true;
			}
			if (outcome.status === "conflict") {
				dirtyRef.current = false;
				setSaveError(null);
				reportState("saved");
				onConflict?.();
				return false;
			}
			// A newer local document supersedes the failed snapshot and can retry
			// from the same content version once the old request has settled.
			if (dirtyRef.current) return saveRef.current();
			setSaveError(
				userErrorMessage(
					outcome.error,
					"Your page changes could not be saved.",
				),
			);
			reportState("error");
			return false;
		}
		if (!dirtyRef.current) return true;
		dirtyRef.current = false;
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
					saveAgainAfterSuccess = dirtyRef.current;
					if (!dirtyRef.current) reportState("saved");
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
				(error) => {
					if (error instanceof ContractError && error.status === 409) {
						// Someone else saved a newer version. Don't retry over it —
						// hand off so the owner reloads the doc into a fresh editor.
						dirtyRef.current = false;
						setSaveError(null);
						reportState("saved");
						onConflict?.();
						return { status: "conflict" } satisfies DocumentSaveOutcome;
					}
					dirtyRef.current = true;
					setSaveError(
						userErrorMessage(error, "Your page changes could not be saved."),
					);
					reportState("error");
					return { status: "error", error } satisfies DocumentSaveOutcome;
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
		// Viewers must never autosave: with collaboration on, remote peers'
		// edits also fire onChange here, and a viewer's save would just 403.
		if (!editable) return;
		normalizeEditorCodeBlockLanguages(editor);
		dirtyRef.current = true;
		setSaveError(null);
		reportState("pending");
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => saveRef.current(), AUTOSAVE_DELAY_MS);
	}, [editor, reportState, editable]);

	// Retain the page-scoped coordinator through cleanup. If this editor is
	// replaced while its save is running, the replacement adopts that exact
	// result before it can persist a newer document.
	useEffect(() => {
		const releaseQueue = documentSaveQueues.retain(documentSaveQueue);
		const lastResult = documentSaveQueue.lastResult;
		if (lastResult?.status === "saved") {
			advanceBaseUpdatedAt(lastResult.contentUpdatedAt);
		}
		const precedingSave = documentSaveQueue.inFlight;
		if (precedingSave) {
			let active = true;
			void precedingSave.then((outcome) => {
				if (outcome.status === "saved") {
					advanceBaseUpdatedAt(outcome.contentUpdatedAt);
				} else if (outcome.status === "conflict" && active) {
					// The component that started the request may already be gone. The
					// replacement must reload its own editor, not only invalidate cache.
					void onConflictRef.current?.();
				}
			});
			return () => {
				active = false;
				if (timeoutRef.current) clearTimeout(timeoutRef.current);
				void saveRef.current().finally(releaseQueue);
			};
		}
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			void saveRef.current().finally(releaseQueue);
		};
	}, [advanceBaseUpdatedAt, documentSaveQueue]);

	useEffect(() => {
		return registerPageSaveFlusher(pageId, async () => {
			return drainPageSaveQueue({
				clearPendingTimer: () => {
					if (timeoutRef.current) {
						clearTimeout(timeoutRef.current);
						timeoutRef.current = null;
					}
				},
				hasPendingChanges: () =>
					dirtyRef.current || documentSaveQueue.inFlight !== null,
				save: () => saveRef.current(),
			});
		});
	}, [documentSaveQueue, pageId]);

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
			{saveError ? (
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
			{collab ? <PresencePublisher room={collab} /> : null}
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
