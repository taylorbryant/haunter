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
	AddBlockButton,
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
	GripVerticalIcon,
	LightbulbIcon,
	PenToolIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useDraftSafeRouter as useRouter } from "@/client/use-draft-safe-router";
import { useTheme } from "next-themes";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { apiClient } from "@/client";
import { useDurableDraftStorage } from "@/client/durable-draft-storage-provider";
import {
	DurableDraftController,
	type DurableDraftSnapshot,
} from "@/client/durable-drafts";
import { reportUserError, userErrorMessage } from "@/client/error-feedback";
import { localDraftKey } from "@/client/local-drafts";
import { Button } from "@/components/ui/button";
import { createCanvas } from "@/features/canvases/contracts";
import { invalidateNotifications } from "@/features/notifications/client/queries";
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
import { registerPageSaveFlusher } from "@/features/pages/client/save-state";
import { uploadPageImage } from "@/features/pages/client/upload";
import { createPage } from "@/features/pages/contracts";
import { containsBlockId } from "@/features/pages/lib/block-tree";
import {
	normalizeCodeBlockLanguage,
	normalizeCodeBlockLanguages,
} from "@/features/pages/lib/code-block-language";
import { createSubpageLinkBlock } from "@/features/pages/lib/subpage-link-block";
import {
	type BlockJson,
	PageContentSchema,
	type PageMeta,
} from "@/features/pages/schemas";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";
import { useIsMobile } from "@/hooks/use-mobile";
import { getResolvedThemeColorScheme } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { EditorBodySkeleton } from "../page-editor-skeleton";
import { finishBlockDrag } from "./block-drag";
import {
	OPEN_CODE_BLOCK_DIALOG_EVENT,
	type OpenCodeBlockDialogDetail,
} from "./code-block-dialog-event";
import { CodeEditDialog } from "./code-edit-dialog";
import { useSyncEditorCodeTheme } from "./code-theme";
import { removeBlockFromSideMenu } from "./remove-block-from-side-menu";
import { editorSchema, syntaxHighlightingExtension } from "./schema";
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

function StableDragHandleButton() {
	const Components = useComponentsContext();
	const editor = useBlockNoteEditor(editorSchema);
	const sideMenu = useExtension(SideMenuExtension, { editor });
	const hoveredBlock = useExtensionState(SideMenuExtension, {
		editor,
		selector: (state) => state?.block,
	});

	if (!Components || !hoveredBlock) return null;

	return (
		<Components.Generic.Menu.Root
			onOpenChange={(open) => {
				if (open) {
					sideMenu.freezeMenu();
				} else {
					sideMenu.unfreezeMenu();
				}
			}}
			position="left"
		>
			<Components.Generic.Menu.Trigger>
				<Components.SideMenu.Button
					label="Drag block"
					draggable
					onDragStart={(event) => sideMenu.blockDragStart(event, hoveredBlock)}
					onDragEnd={() => finishBlockDrag(sideMenu)}
					className="bn-button"
					icon={<GripVerticalIcon data-test="dragHandle" />}
				/>
			</Components.Generic.Menu.Trigger>
			<DragHandleMenu>
				<RemoveBlockMenuItem />
			</DragHandleMenu>
		</Components.Generic.Menu.Root>
	);
}

function StableSideMenu() {
	return (
		<SideMenu>
			<AddBlockButton />
			<StableDragHandleButton />
		</SideMenu>
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

export type SaveState = "saved" | "pending" | "saving" | "error" | "paused";

function cloneDocument(content: BlockJson[]): BlockJson[] {
	return structuredClone(content);
}

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

type PageContentSaveMetadata = {
	updatedAt: string;
	tasksChanged: boolean;
	linksChanged: boolean;
};

type PageContentDraftController = DurableDraftController<
	BlockJson[],
	PageContentSaveMetadata
>;

type MountedHaunterEditorProps = HaunterEditorProps & {
	controller: PageContentDraftController | null;
	draft: DurableDraftSnapshot<BlockJson[]>;
};

export default function HaunterEditor(props: HaunterEditorProps) {
	const [mounted, setMounted] = useState(false);

	// Keep the editor in the route bundle, but do not render BlockNote until the
	// browser is mounted because one of its hooks dereferences `window`.
	useEffect(() => setMounted(true), []);

	if (!mounted) {
		return (
			<div className="py-2">
				<EditorBodySkeleton />
			</div>
		);
	}

	if (props.editable !== false && props.currentUserId) {
		return <DurablePageBody {...props} currentUserId={props.currentUserId} />;
	}

	const content = normalizeCodeBlockLanguages(props.initialContent);
	return (
		<MountedHaunterEditor
			{...props}
			controller={null}
			draft={{
				status: "saved",
				value: content,
				serverValue: content,
				serverVersion: props.contentUpdatedAt ?? null,
				error: null,
				validationError: null,
				dirty: false,
			}}
		/>
	);
}

function DurablePageBody(
	props: HaunterEditorProps & { currentUserId: string },
) {
	const queryClient = useQueryClient();
	const storage = useDurableDraftStorage<BlockJson[]>();
	const saveMutation = useMutation({
		...savePageContentMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const lifecycleGeneration = useRef(0);
	const normalizedServerContent = useMemo(
		() => normalizeCodeBlockLanguages(props.initialContent),
		[props.initialContent],
	);
	const [controller] = useState(
		() =>
			new DurableDraftController<BlockJson[], PageContentSaveMetadata>({
				identity: {
					key: localDraftKey(props.currentUserId, "page", props.pageId),
					userId: props.currentUserId,
					workspaceId: props.workspaceId,
					resourceType: "page",
					resourceId: props.pageId,
				},
				serverValue: normalizedServerContent,
				serverVersion: props.contentUpdatedAt ?? null,
				storage,
				localDebounceMs: 100,
				debounceMs: AUTOSAVE_DELAY_MS,
				isPayload: (value): value is BlockJson[] =>
					PageContentSchema.safeParse(value).success,
				areValuesEqual: (left, right) =>
					JSON.stringify(left) === JSON.stringify(right),
				isConflictError: (error) =>
					error instanceof ContractError && error.status === 409,
				loadServer: async () => {
					const latest = await queryClient.fetchQuery({
						...getPageQueryOptions(props.pageId),
						staleTime: 0,
					});
					return {
						value: normalizeCodeBlockLanguages(latest.content),
						version: latest.contentUpdatedAt,
					};
				},
				onServerSaved: (result) => {
					const metadata = result.metadata;
					setPageContentInCache(queryClient, props.pageId, result.value);
					if (metadata) {
						setPageSavedAtInCache(
							queryClient,
							props.pageId,
							metadata.updatedAt,
							result.version ?? metadata.updatedAt,
						);
						if (metadata.linksChanged) invalidateBacklinks(queryClient);
						if (metadata.tasksChanged) {
							invalidateTasksWhenIdle(queryClient);
							invalidateNotifications(queryClient);
						}
					}
				},
				saveServer: async ({ value, baseVersion }) => {
					const result = await saveMutation.mutateAsync({
						path: { id: props.pageId },
						body: {
							content: value,
							...(baseVersion ? { baseUpdatedAt: baseVersion } : {}),
						},
					});
					return {
						value,
						version: result.contentUpdatedAt,
						metadata: {
							updatedAt: result.updatedAt,
							linksChanged: result.linksChanged,
							tasksChanged: result.tasksChanged,
						},
					};
				},
			}),
	);
	const draft = useSyncExternalStore(
		controller.subscribe,
		controller.getUncontrolledSnapshot,
		controller.getUncontrolledSnapshot,
	);

	useEffect(() => {
		const generation = ++lifecycleGeneration.current;
		controller.start();
		const unregisterFlusher = registerPageSaveFlusher(props.pageId, () =>
			controller.flushServer(),
		);
		return () => {
			unregisterFlusher();
			void controller.flushLocal().catch(() => undefined);
			queueMicrotask(() => {
				if (lifecycleGeneration.current !== generation) return;
				void controller.flushServer().finally(() => {
					if (lifecycleGeneration.current === generation) controller.stop();
				});
			});
		};
	}, [controller, props.pageId]);

	useEffect(() => {
		controller.refreshServer(
			normalizedServerContent,
			props.contentUpdatedAt ?? null,
		);
	}, [controller, normalizedServerContent, props.contentUpdatedAt]);

	if (draft.status === "loading") {
		return (
			<div className="py-2">
				<EditorBodySkeleton />
			</div>
		);
	}

	return (
		<MountedHaunterEditor {...props} controller={controller} draft={draft} />
	);
}

function MountedHaunterEditor({
	pageId,
	workspaceId,
	editable = true,
	focusRequest = 0,
	currentUserId = null,
	onSaveStateChange,
	controller,
	draft,
}: MountedHaunterEditorProps) {
	const { resolvedTheme } = useTheme();
	const router = useRouter();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const isMobile = useIsMobile();
	const applyingActorValue = useRef(false);
	const projectedValue = useRef(draft.value);
	const [editorInitialContent] = useState(() =>
		normalizeCodeBlockLanguages(draft.value),
	);

	const editor = useCreateBlockNote({
		schema: editorSchema,
		extensions: [syntaxHighlightingExtension],
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
			controller?.rebaseServer(
				cloneDocument(editor.document as unknown as BlockJson[]),
				parentContentUpdatedAt,
			);
			return true;
		},
		[controller, editor],
	);

	useEffect(() => {
		if (!editable) return;
		return registerSubpageLinkAppender(pageId, appendSubpageLink);
	}, [editable, pageId, appendSubpageLink]);

	// Keep BlockNote as a projection of the durable actor. Local editor changes
	// are already identical to the actor value; this path applies recovered,
	// remote, and explicitly selected conflict versions without re-enqueuing them.
	useEffect(() => {
		if (draft.status === "conflict") return;
		const next = draft.value;
		if (projectedValue.current === next) return;

		applyingActorValue.current = true;
		editor.replaceBlocks(
			editor.document,
			(next.length > 0 ? next : [{ type: "paragraph" }]) as never,
		);
		requestAnimationFrame(() => {
			applyingActorValue.current = false;
		});
		projectedValue.current = next;
	}, [draft.status, draft.value, editor]);

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

	const saveState: SaveState =
		draft.status === "paused"
			? "paused"
			: draft.status === "saved"
				? "saved"
				: draft.status === "saving-local" || draft.status === "pending"
					? "pending"
					: draft.status === "syncing"
						? "saving"
						: "error";
	const isBusy =
		draft.status === "saving-local" ||
		draft.status === "syncing" ||
		draft.status === "resolving";
	const hasSaveConflict =
		draft.status === "conflict" || draft.status === "resolving";
	const canRetry =
		draft.status === "storage-error" || draft.status === "sync-error";
	const saveError = draft.validationError
		? draft.validationError
		: draft.status === "storage-error"
			? userErrorMessage(
					draft.error,
					"Your page changes could not be saved in this browser.",
				)
			: draft.status === "sync-error" && !draft.remotePaused
				? "Your changes are saved in this browser but could not be synced."
				: draft.status === "conflict" && draft.error
					? userErrorMessage(draft.error, "The conflict could not be resolved.")
					: null;

	// BlockNote may report a document change while React is still rendering its
	// editor tree. Keep that callback local, then notify the layout-level store
	// after the render commits so HeaderSaveIndicator is never updated during a
	// different component's render phase.
	useEffect(() => {
		onSaveStateChange?.(saveState);
	}, [onSaveStateChange, saveState]);

	const handleChange = useCallback(() => {
		if (!editable || applyingActorValue.current || !controller) return;
		normalizeEditorCodeBlockLanguages(editor);
		const content = cloneDocument(editor.document as unknown as BlockJson[]);
		projectedValue.current = content;
		controller.edit(content);
	}, [controller, editable, editor]);

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
					className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm md:mx-[54px]"
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
						disabled={isBusy}
						onClick={() => void controller?.useServer()}
					>
						Load latest
					</Button>
					<Button
						type="button"
						variant="destructive"
						size="sm"
						disabled={isBusy}
						onClick={() => void controller?.keepMine()}
					>
						Save my version
					</Button>
				</div>
			) : saveError ? (
				<div
					role="alert"
					className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-destructive text-sm md:mx-[54px]"
				>
					<span className="flex-1">{saveError}</span>
					{canRetry ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={isBusy}
							onClick={() => void controller?.retry()}
						>
							Retry
						</Button>
					) : null}
				</div>
			) : null}
			<TaskBlockCurrentUserContext.Provider value={currentUserId}>
				<BlockNoteView
					editor={editor}
					editable={editable && draft.status !== "resolving"}
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
					{!isMobile ? <SideMenuController sideMenu={StableSideMenu} /> : null}
				</BlockNoteView>
			</TaskBlockCurrentUserContext.Provider>
			{codeDialogBlockId ? (
				<CodeEditDialog
					editor={editor}
					blockId={codeDialogBlockId}
					editable={editable && draft.status !== "resolving"}
					onClose={() => setCodeDialogBlockId(null)}
				/>
			) : null}
			<span className="sr-only" aria-live="polite">
				{saveState === "saving" || saveState === "pending"
					? "Saving"
					: saveState === "paused"
						? "Saved in this browser"
						: saveState === "error"
							? "Save failed"
							: "Saved"}
			</span>
		</div>
	);
}
