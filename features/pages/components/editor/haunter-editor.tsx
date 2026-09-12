"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import {
	type BlockNoteEditor,
	filterSuggestionItems,
	insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { withCollaboration } from "@blocknote/core/yjs";
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
import { useQueryClient } from "@tanstack/react-query";
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
	observeEditorPerformance,
	type EditorMeasurement,
} from "@/features/pages/client/editor-performance";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/client";
import { downloadRecoveryDrafts } from "@/client/draft-export";
import { useDurableDraftStorage } from "@/client/durable-draft-storage-provider";
import { reportUserError } from "@/client/error-feedback";
import { localDraftKey } from "@/client/local-drafts";
import { usePageDocument } from "@/features/documents/client/use-page-document";
import type { PageDocumentSession } from "@/features/documents/client/session";
import { PAGE_BODY_FRAGMENT } from "@/features/documents/model";
import { Button } from "@/components/ui/button";
import { createCanvas } from "@/features/canvases/contracts";
import { focusTitleOnArrival } from "@/features/pages/client/new-page-focus";
import { registerSubpageLinkAppender } from "@/features/pages/client/open-page-content";
import {
	getPageQueryOptions,
	invalidateBacklinks,
	invalidatePages,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import { registerPageSaveFlusher } from "@/features/pages/client/save-state";
import { uploadPageImage } from "@/features/pages/client/upload";
import { createPage } from "@/features/pages/contracts";
import { normalizeCodeBlockLanguages } from "@/features/pages/lib/code-block-language";
import { createSubpageLinkBlock } from "@/features/pages/lib/subpage-link-block";
import type { BlockJson, PageMeta } from "@/features/pages/schemas";
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
import { registerTaskCreator } from "./task-block";
import { useSyncEditorCodeTheme } from "./code-theme";
import { removeBlockFromSideMenu } from "./remove-block-from-side-menu";
import { editorSchema, syntaxHighlightingExtension } from "./schema";
import { TaskBlockCurrentUserContext } from "./task-block";

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

type HaunterEditorProps = {
	measurement?: EditorMeasurement;
	pageId: string;
	workspaceId: string;
	initialContent: BlockJson[];
	editable?: boolean;
	/** Incremented by the owner when focus should move from the title to body. */
	focusRequest?: number;
	/** Current signed-in user, used for same-user authoring defaults. */
	currentUserId?: string | null;
	currentUserName?: string;
	onSaveStateChange?: (state: SaveState) => void;
};

type MountedHaunterEditorProps = HaunterEditorProps & {
	collaboration?: PageDocumentSession;
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

	if (props.currentUserId) {
		const url = process.env.NEXT_PUBLIC_COLLABORATION_URL;
		if (!url)
			return <p role="alert">The editor connection is not configured.</p>;
		return (
			<CollaborativePageBody
				{...props}
				currentUserId={props.currentUserId}
				url={url}
			/>
		);
	}
	return <MountedHaunterEditor {...props} editable={false} />;
}

function CollaborativePageBody(
	props: HaunterEditorProps & { currentUserId: string; url: string },
) {
	const { session, snapshot } = usePageDocument({
		pageId: props.pageId,
		workspaceId: props.workspaceId,
		userId: props.currentUserId,
		url: props.url,
	});
	const queryClient = useQueryClient();
	const storage = useDurableDraftStorage<BlockJson[]>();
	const [oldDraft, setOldDraft] = useState<BlockJson[] | null>(null);
	const [recoveryError, setRecoveryError] = useState<string | null>(null);
	const [recoveryGeneration, setRecoveryGeneration] = useState<number | null>(
		null,
	);
	useEffect(() => {
		let active = true;
		void storage
			.load(localDraftKey(props.currentUserId, "page", props.pageId))
			.then((draft) => {
				if (active && draft) setOldDraft(draft.payload);
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [props.currentUserId, props.pageId, storage]);
	useEffect(() => {
		if (!session) return;
		return registerPageSaveFlusher(props.pageId, async () => {
			const saved = await session.flushServer();
			if (saved)
				await queryClient.fetchQuery({
					...getPageQueryOptions(props.pageId),
					staleTime: 0,
				});
			return saved;
		});
	}, [session, props.pageId, queryClient]);
	useEffect(() => {
		props.onSaveStateChange?.(
			snapshot.error
				? "error"
				: snapshot.saved
					? "saved"
					: snapshot.paused
						? "paused"
						: snapshot.connected
							? "saving"
							: "pending",
		);
	}, [
		props.onSaveStateChange,
		snapshot.error,
		snapshot.saved,
		snapshot.paused,
		snapshot.connected,
	]);
	useEffect(() => {
		if (!snapshot.tasksRevision) return;
		invalidateTasksWhenIdle(queryClient);
	}, [snapshot.tasksRevision, queryClient]);
	useEffect(() => {
		if (!snapshot.linksRevision) return;
		invalidateBacklinks(queryClient);
	}, [snapshot.linksRevision, queryClient]);
	return (
		<>
			{snapshot.recoveries.length > 0 && session ? (
				<div
					role="status"
					className="mb-3 rounded-lg border p-3 text-sm md:mx-[54px]"
				>
					This page was restored. Previous copies, including pending edits, are
					kept in this browser. Download a copy, then use Recover drafts in the
					Pages menu to open it as a new page.
					{snapshot.recoveries.length > 1 ? (
						<label className="mt-2 flex items-center gap-2">
							Recovery copy
							<select
								className="rounded-md border bg-background p-1"
								value={recoveryGeneration ?? snapshot.recoveries[0]}
								onChange={(event) =>
									setRecoveryGeneration(Number(event.target.value))
								}
							>
								{snapshot.recoveries.map((generation) => (
									<option key={generation} value={generation}>
										Before restore {generation + 1}
									</option>
								))}
							</select>
						</label>
					) : null}
					<Button
						variant="outline"
						size="sm"
						className="mt-2"
						onClick={() => {
							setRecoveryError(null);
							void session
								.recoveryDownload(recoveryGeneration ?? snapshot.recoveries[0])
								.then((file) => {
									const url = URL.createObjectURL(
										new Blob([file], { type: "application/json" }),
									);
									const link = document.createElement("a");
									link.href = url;
									link.download = "haunter-before-restore.json";
									link.hidden = true;
									document.body.append(link);
									link.click();
									link.remove();
									setTimeout(() => URL.revokeObjectURL(url), 1000);
								})
								.catch(() =>
									setRecoveryError(
										"The recovery copy could not be downloaded. Keep this tab open and try again.",
									),
								);
						}}
					>
						Download previous copy
					</Button>
					{recoveryError ? (
						<p role="alert" className="mt-2 text-destructive">
							{recoveryError}
						</p>
					) : null}
				</div>
			) : null}

			{oldDraft ? (
				<div
					role="alert"
					className="mb-3 rounded-lg border p-3 text-sm md:mx-[54px]"
				>
					A draft from the previous editor is still stored in this browser. Use
					Recover drafts in the Pages menu to import its download.
					<Button
						variant="outline"
						size="sm"
						className="ml-2"
						onClick={() => {
							const url = URL.createObjectURL(
								new Blob([JSON.stringify(oldDraft, null, 2)], {
									type: "application/json",
								}),
							);
							const link = document.createElement("a");
							link.href = url;
							link.download = `page-${props.pageId}-previous-draft.json`;
							link.hidden = true;
							document.body.append(link);
							link.click();
							link.remove();
							setTimeout(() => URL.revokeObjectURL(url), 1000);
						}}
					>
						Download previous draft
					</Button>
				</div>
			) : null}
			<div
				data-testid="document-status"
				data-ready-source={snapshot.readySource ?? "loading"}
				data-ready-ms={snapshot.readyMs ?? ""}
				data-saved={snapshot.saved}
			>
				{snapshot.error ? (
					<div className="mb-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs md:mx-[54px]">
						<span role="alert">{snapshot.error}</span>
						{session ? (
							<>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => void session.retry().catch(() => undefined)}
								>
									Retry
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => downloadRecoveryDrafts(props.currentUserId)}
								>
									Download unsynced changes
								</Button>
							</>
						) : null}
					</div>
				) : null}
			</div>
			{session && snapshot.ready && !snapshot.restoring ? (
				<MountedHaunterEditor
					key={snapshot.generation}
					{...props}
					onSaveStateChange={undefined}
					collaboration={session}
				/>
			) : (
				<EditorBodySkeleton />
			)}
		</>
	);
}

const MountedHaunterEditor = memo(function MountedHaunterEditor({
	measurement,
	pageId,
	workspaceId,
	editable = true,
	focusRequest = 0,
	currentUserId = null,
	currentUserName = "Collaborator",
	initialContent,
	collaboration,
}: MountedHaunterEditorProps) {
	const { resolvedTheme } = useTheme();
	const router = useRouter();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const isMobile = useIsMobile();
	const editorElement = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!measurement || !editorElement.current) return;
		return observeEditorPerformance(
			editorElement.current,
			measurement,
			collaboration?.getSnapshot(),
		);
	}, [measurement, collaboration]);
	const [editorInitialContent] = useState(() =>
		normalizeCodeBlockLanguages(initialContent),
	);

	const editorOptions = {
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
		initialContent:
			!collaboration && editorInitialContent.length
				? // The server stores the document verbatim; the editor owns its shape.
					(editorInitialContent as never)
				: undefined,
	};
	const editor = useCreateBlockNote(
		collaboration
			? withCollaboration({
					...editorOptions,
					initialContent: undefined,
					collaboration: {
						fragment: collaboration.doc.getXmlFragment(PAGE_BODY_FRAGMENT),
						user: { name: currentUserName, color: "#a78bfa" },
						provider: collaboration.provider?.awareness
							? { awareness: collaboration.provider.awareness }
							: undefined,
					},
				})
			: editorOptions,
	);
	useSyncEditorCodeTheme(editor, resolvedTheme);
	useEffect(
		() => registerTaskCreator(editor, currentUserId),
		[editor, currentUserId],
	);

	useEffect(() => {
		if (!editable) return;
		// The server appends Yjs nodes; inserting again would duplicate the link.
		return registerSubpageLinkAppender(pageId, () => true);
	}, [editable, pageId]);

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
		<div
			ref={editorElement}
			className={cn("haunter-editor", isMobile && "editor-flush")}
		>
			<TaskBlockCurrentUserContext.Provider value={currentUserId}>
				<BlockNoteView
					editor={editor}
					editable={editable}
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
					editable={editable}
					onClose={() => setCodeDialogBlockId(null)}
				/>
			) : null}
		</div>
	);
});
