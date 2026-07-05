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
	BlockColorsItem,
	DragHandleMenu,
	getDefaultReactSlashMenuItems,
	RemoveBlockItem,
	SideMenu,
	SideMenuController,
	SuggestionMenuController,
	useBlockNoteEditor,
	useComponentsContext,
	useCreateBlockNote,
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
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import { apiClient } from "@/client";
import { createCanvas } from "@/features/canvases/contracts";
import type { CollabRoom } from "@/features/collab/client/liveblocks";
import { setCollabPresence } from "@/features/collab/client/presence-state";
import {
	invalidateBacklinks,
	invalidatePage,
	invalidatePages,
	listPagesQueryOptions,
	savePageContentMutationOptions,
	setPageContentInCache,
	setPageSavedAtInCache,
} from "@/features/pages/client/queries";
import { uploadPageImage } from "@/features/pages/client/upload";
import { createPage } from "@/features/pages/contracts";
import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { CodeEditDialog } from "./code-edit-dialog";
import { editorSchema } from "./schema";

const AUTOSAVE_DELAY_MS = 1000;

type HaunterBlockNoteEditor = BlockNoteEditor<
	(typeof editorSchema)["blockSchema"],
	(typeof editorSchema)["inlineContentSchema"],
	(typeof editorSchema)["styleSchema"]
>;

/** Block-menu item to open a code block in the larger editing dialog. */
function EditCodeMenuItem({ onOpen }: { onOpen: (blockId: string) => void }) {
	const Components = useComponentsContext();
	const editor = useBlockNoteEditor();
	const block = useExtensionState(SideMenuExtension, {
		editor,
		selector: (state) => state?.block,
	});

	if (!Components || !block || block.type !== "codeBlock") {
		return null;
	}

	return (
		<Components.Generic.Menu.Item
			className="bn-menu-item"
			onClick={() => onOpen(block.id)}
		>
			Edit in dialog
		</Components.Generic.Menu.Item>
	);
}

function getSlashMenuItems(
	editor: HaunterBlockNoteEditor,
	query: string,
	page: {
		pageId: string;
		workspaceId: string;
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
			insertOrUpdateBlockForSlashMenu(editor, { type: "task" });
		},
	};

	const canvasItem = {
		title: "Canvas",
		subtext: "An embedded tldraw drawing canvas",
		aliases: ["canvas", "draw", "drawing", "sketch", "tldraw", "excalidraw"],
		group: "Basic blocks",
		icon: <PenToolIcon className="size-4.5" />,
		onItemClick: async () => {
			// Create the row first so the block never points at a missing canvas.
			const canvas = await apiClient.endpoint(createCanvas).call({
				body: { workspaceId: page.workspaceId, pageId: page.pageId },
			});
			insertOrUpdateBlockForSlashMenu(editor, {
				type: "canvas",
				props: { canvasId: canvas.id },
			});
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
			// Create the row first so the block never points at a missing page.
			const created = await apiClient.endpoint(createPage).call({
				body: {
					workspaceId: page.workspaceId,
					parentPageId: page.pageId,
					title: "Untitled",
				},
			});
			insertOrUpdateBlockForSlashMenu(editor, {
				type: "pageLink",
				props: { pageId: created.id, workspaceId: page.workspaceId },
			});
			page.onSubpageCreated(created);
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

type HaunterEditorProps = {
	pageId: string;
	workspaceId: string;
	initialContent: BlockJson[];
	/** The document version this editor was initialized from. */
	updatedAt?: string;
	editable?: boolean;
	/**
	 * The page's synced Liveblocks room, or null for local-only editing.
	 * PageEditor owns the session lifecycle (and its connecting/fallback
	 * states) so the title can share the same doc.
	 */
	collab?: CollabRoom | null;
	/** Cursor identity shown to collaborators when collaboration is on. */
	collabUser?: { name: string; color: string };
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
	updatedAt,
	editable = true,
	collabUser,
	collab = null,
	onSaveStateChange,
	onConflict,
}: HaunterEditorProps) {
	const { resolvedTheme } = useTheme();
	const router = useRouter();
	const queryClient = useQueryClient();
	const isMobile = useIsMobile();
	const [saveState, setSaveState] = useState<SaveState>("saved");
	// Last server updatedAt this editor saw: the optimistic-concurrency base.
	const baseUpdatedAtRef = useRef<string | null>(updatedAt ?? null);

	// Whether the shared doc needs seeding from the database, decided once at
	// mount — before BlockNote binds the fragment and materializes its empty
	// paragraph into it. The doc-level "seeded" flag keeps a second client
	// that joins in the same instant from double-inserting.
	const [shouldSeed] = useState(() => {
		if (!collab) return false;
		const fragment = collab.doc.getXmlFragment("blocknote");
		const meta = collab.doc.getMap<boolean>("haunter-meta");
		return fragment.length === 0 && meta.get("seeded") !== true;
	});

	const editor = useCreateBlockNote({
		schema: editorSchema,
		uploadFile: (file: File) => uploadPageImage(pageId, file),
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
			!collab && initialContent.length
				? // The server stores the document verbatim; the editor owns its shape.
					(initialContent as never)
				: undefined,
	});

	// Seed a brand-new shared doc from the database copy exactly once.
	const seededRef = useRef(false);
	useEffect(() => {
		if (!collab || !shouldSeed || seededRef.current) return;
		seededRef.current = true;
		if (initialContent.length === 0) return;
		collab.doc.getMap<boolean>("haunter-meta").set("seeded", true);
		editor.replaceBlocks(editor.document, initialContent as never);
	}, [collab, shouldSeed, editor, initialContent]);

	const saveMutation = useMutation(savePageContentMutationOptions());
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dirtyRef = useRef(false);
	const saveRef = useRef<() => void>(() => {});

	const reportState = useCallback(
		(state: SaveState) => {
			setSaveState(state);
			onSaveStateChange?.(state);
		},
		[onSaveStateChange],
	);

	saveRef.current = () => {
		if (!dirtyRef.current) return;
		dirtyRef.current = false;
		reportState("saving");
		const content = editor.document as unknown as BlockJson[];
		// Mirror into the cache immediately: a remount between this save and
		// the next refetch must not initialize the editor from a stale doc.
		setPageContentInCache(queryClient, pageId, content);
		saveMutation.mutate(
			{
				path: { id: pageId },
				body: {
					content,
					// With collaboration on, Yjs already merges concurrent edits and
					// every peer persists the same converged doc — a CAS precondition
					// would only produce false 409s between peers.
					...(baseUpdatedAtRef.current && !collab
						? { baseUpdatedAt: baseUpdatedAtRef.current }
						: {}),
				},
			},
			{
				onSuccess: (result) => {
					baseUpdatedAtRef.current = result.updatedAt;
					if (!dirtyRef.current) reportState("saved");
					setPageSavedAtInCache(queryClient, pageId, result.updatedAt);
					invalidatePage(queryClient, pageId);
					invalidateBacklinks(queryClient);
				},
				onError: (error) => {
					if (error instanceof ContractError && error.status === 409) {
						// Someone else saved a newer version. Don't retry over it —
						// hand off so the owner reloads the doc into a fresh editor.
						dirtyRef.current = false;
						reportState("saved");
						onConflict?.();
						return;
					}
					dirtyRef.current = true;
					reportState("error");
				},
			},
		);
	};

	const handleChange = useCallback(() => {
		// Viewers must never autosave: with collaboration on, remote peers'
		// edits also fire onChange here, and a viewer's save would just 403.
		if (!editable) return;
		dirtyRef.current = true;
		reportState("pending");
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => saveRef.current(), AUTOSAVE_DELAY_MS);
	}, [reportState, editable]);

	// Flush any pending save when the page unmounts (navigation away).
	useEffect(() => {
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			saveRef.current();
		};
	}, []);

	const [codeDialogBlockId, setCodeDialogBlockId] = useState<string | null>(
		null,
	);

	return (
		// On mobile, `editor-flush` drops BlockNote's 54px inline gutter so
		// content runs edge-to-edge; the block controls that live there are
		// hidden below. Driven from JS (not CSS) to share one breakpoint.
		<div className={cn("haunter-editor", isMobile && "editor-flush")}>
			{collab ? <PresencePublisher room={collab} /> : null}
			<BlockNoteView
				editor={editor}
				editable={editable}
				onChange={handleChange}
				theme={resolvedTheme === "dark" ? "dark" : "light"}
				slashMenu={false}
				sideMenu={false}
			>
				<SuggestionMenuController
					triggerCharacter="/"
					getItems={(query) =>
						getSlashMenuItems(editor, query, {
							pageId,
							workspaceId,
							// Open the new subpage; the unmount flush persists the
							// parent document (with the link block) on the way out.
							onSubpageCreated: async (created) => {
								await invalidatePages(queryClient);
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
										<RemoveBlockItem>Delete</RemoveBlockItem>
										<BlockColorsItem>Colors</BlockColorsItem>
										<EditCodeMenuItem onOpen={setCodeDialogBlockId} />
									</DragHandleMenu>
								)}
							/>
						)}
					/>
				) : null}
			</BlockNoteView>
			{codeDialogBlockId ? (
				<CodeEditDialog
					editor={editor}
					blockId={codeDialogBlockId}
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
