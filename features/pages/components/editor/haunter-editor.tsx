"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

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
import { useQueryClient } from "@tanstack/react-query";
import {
	CheckSquareIcon,
	FilePlusIcon,
	FileTextIcon,
	LightbulbIcon,
	PenToolIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import { apiClient } from "@/client";
import { reportUserError, userErrorMessage } from "@/client/error-feedback";
import { Button } from "@/components/ui/button";
import { createCanvas } from "@/features/canvases/contracts";
import { setCollabPresence } from "@/features/collab/client/presence-state";
import {
	type CollabRoom,
	waitForCollabPersistence,
} from "@/features/collab/client/session";
import { queueMaterialization } from "@/features/documents/client/materialization";
import {
	recordPendingTaskAttributions,
	snapshotPendingTaskAttributions,
} from "@/features/documents/client/task-attribution";
import { pageFragmentName } from "@/features/documents/model";
import { focusTitleOnArrival } from "@/features/pages/client/new-page-focus";
import {
	invalidatePages,
	listPagesQueryOptions,
	setPageContentInCache,
} from "@/features/pages/client/queries";
import {
	createInFlightSaveQueueStore,
	drainPageSaveQueue,
	type InFlightSaveQueue,
	registerPageSaveFlusher,
} from "@/features/pages/client/save-state";
import { uploadPageImage } from "@/features/pages/client/upload";
import { createPage } from "@/features/pages/contracts";
import { normalizeCodeBlockLanguage } from "@/features/pages/lib/code-block-language";
import {
	type TaskAttributionBlockChange,
	taskAttributionsForChanges,
} from "@/features/pages/lib/collab-document";
import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import { useIsMobile } from "@/hooks/use-mobile";
import { getResolvedThemeColorScheme } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { withHaunterCollaboration } from "./blocknote-collaboration";
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
	| { status: "saved" }
	| { status: "error"; error: unknown };

const documentSaveQueues = createInFlightSaveQueueStore<DocumentSaveOutcome>();

type HaunterEditorProps = {
	pageId: string;
	workspaceId: string;
	editable?: boolean;
	/** The page's synchronized, authoritative Liveblocks room. */
	collab: CollabRoom;
	/** Active immutable document generation; null identifies pre-generation rooms. */
	collabGeneration?: string | null;
	/** Cursor identity shown to collaborators when collaboration is on. */
	collabUser?: { name: string; color: string };
	/** Incremented by the owner when focus should move from the title to body. */
	focusRequest?: number;
	/** Current signed-in user, used for same-user authoring defaults. */
	currentUserId?: string | null;
	onSaveStateChange?: (state: SaveState) => void;
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
	editable = true,
	collabUser,
	collab,
	collabGeneration = null,
	focusRequest = 0,
	currentUserId = null,
	onSaveStateChange,
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

	useEffect(() => {
		if (
			!editable ||
			!currentUserId ||
			snapshotPendingTaskAttributions(pageId, currentUserId).length === 0
		) {
			return;
		}
		void queueMaterialization("page", pageId, currentUserId).catch(() => {
			// Keep the browser-persisted record. A later mount or save retries it.
		});
	}, [currentUserId, editable, pageId]);

	const editorOptions = {
		schema: editorSchema,
		uploadFile: async (file: File) => {
			try {
				return await uploadPageImage(pageId, file);
			} catch (error) {
				reportUserError(error, "The image could not be uploaded.");
				throw error;
			}
		},
	};
	const editor = useCreateBlockNote(
		withHaunterCollaboration(editorOptions, {
			fragment: collab.doc.getXmlFragment(pageFragmentName(collabGeneration)),
			// Liveblocks bundles its own copy of y-protocols, so its Awareness is a
			// structural twin of the one BlockNote expects.
			provider: collab.provider as unknown as { awareness: Awareness },
			user: collabUser ?? { name: "Member", color: "#3b82f6" },
		}),
	);
	useSyncEditorCodeTheme(editor, resolvedTheme);

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
				return dirtyRef.current ? saveRef.current() : true;
			}
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
		const request = (async (): Promise<DocumentSaveOutcome> => {
			try {
				if (!(await waitForCollabPersistence(collab))) {
					throw new Error("The shared page did not finish synchronizing.");
				}
				await queueMaterialization("page", pageId, currentUserId);
				setSaveError(null);
				if (!dirtyRef.current) reportState("saved");
				return { status: "saved" };
			} catch (error) {
				dirtyRef.current = true;
				setSaveError(
					userErrorMessage(error, "Your page changes could not be saved."),
				);
				reportState("error");
				return { status: "error", error };
			}
		})();
		const outcome = await documentSaveQueues.track(documentSaveQueue, request);
		if (outcome.status === "saved" && dirtyRef.current) {
			void saveRef.current();
		}
		return outcome.status === "saved";
	};

	const handleChange = useCallback(
		(
			_editor: unknown,
			context: { getChanges(): TaskAttributionBlockChange[] },
		) => {
			// Viewers must never autosave: with collaboration on, remote peers'
			// edits also fire onChange here, and a viewer's save would just 403.
			if (!editable) return;
			if (currentUserId) {
				const attributions = taskAttributionsForChanges(context.getChanges());
				recordPendingTaskAttributions(pageId, currentUserId, attributions);
				if (attributions.some((attribution) => attribution.assignee !== null)) {
					// The authenticated request durably records the actor and target before
					// acknowledging the browser queue. If this Yjs update has not reached the
					// provider yet, a later webhook consumes that pending attribution; browser
					// persistence covers a crash before the request reaches the server.
					void queueMaterialization("page", pageId, currentUserId).catch(() => {
						// The browser-persisted queue is retried on the next mount/save.
					});
				}
			}
			normalizeEditorCodeBlockLanguages(editor);
			dirtyRef.current = true;
			setSaveError(null);
			reportState("pending");
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			timeoutRef.current = setTimeout(
				() => saveRef.current(),
				AUTOSAVE_DELAY_MS,
			);
		},
		[currentUserId, editor, pageId, reportState, editable],
	);

	// Retain the page-scoped coordinator through cleanup. If this editor is
	// replaced while its save is running, the replacement adopts that exact
	// result before it can persist a newer document.
	useEffect(() => {
		const releaseQueue = documentSaveQueues.retain(documentSaveQueue);
		const precedingSave = documentSaveQueue.inFlight;
		if (precedingSave) {
			return () => {
				if (timeoutRef.current) clearTimeout(timeoutRef.current);
				void saveRef.current().finally(releaseQueue);
			};
		}
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			void saveRef.current().finally(releaseQueue);
		};
	}, [documentSaveQueue]);

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
						disabled={saveState === "saving"}
						onClick={() => void saveRef.current()}
					>
						Retry
					</Button>
				</div>
			) : null}
			<PresencePublisher room={collab} />
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
