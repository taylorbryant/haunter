import { codeBlockText } from "@/features/pages/lib/mermaid";
import { mountMermaidPreview } from "./mermaid-preview";
import {
	type MermaidView,
	mountMermaidViewControls,
} from "./mermaid-view-controls";

type DiagramEditor = {
	readonly isEditable: boolean;
	getBlock(id: string): { type: string; content?: unknown } | undefined;
	onChange(callback: () => void): () => void;
	onSelectionChange(callback: () => void): () => void;
	getTextCursorPosition(): { block: { id: string } };
	setTextCursorPosition(id: string, placement: "end"): void;
	focus(): void;
};

// Node views are rebuilt on property changes. Keep view choice local to this
// editor, separate from document data, undo history, and other collaborators.
const views = new WeakMap<DiagramEditor, Map<string, MermaidView>>();

export function mountMermaidCodeBlock({
	header,
	pre,
	dom,
	editor,
	blockId,
	source,
}: {
	header: HTMLElement;
	pre: HTMLElement;
	dom: HTMLElement | DocumentFragment;
	editor: DiagramEditor;
	blockId: string;
	source: string;
}) {
	let editorViews = views.get(editor);
	if (!editorViews) {
		editorViews = new Map();
		views.set(editor, editorViews);
	}
	let view = editorViews.get(blockId) ?? (source.trim() ? "diagram" : "source");
	editorViews.set(blockId, view);
	const controls = document.createElement("div");
	controls.className = "haunter-diagram-controls";
	const handleControlsKeyDown = (event: KeyboardEvent) => {
		// Keep button navigation out of ProseMirror's editing shortcuts. Escape
		// can still reach a surrounding history dialog or other dismissible UI.
		if (event.key !== "Escape") event.stopPropagation();
	};
	controls.addEventListener("keydown", handleControlsKeyDown);
	const previewElement = document.createElement("div");
	previewElement.className = "haunter-mermaid-preview";
	previewElement.contentEditable = "false";
	dom.appendChild(previewElement);
	const preview = mountMermaidPreview(previewElement);
	const viewControls = mountMermaidViewControls(controls, view, (next) => {
		view = next;
		editorViews.set(blockId, view);
		update();
		if (view === "source" && editor.isEditable) {
			editor.setTextCursorPosition(blockId, "end");
			editor.focus();
		}
	});

	function update() {
		pre.hidden = view === "diagram";
		previewElement.hidden = view === "source";
		viewControls.update(view);
		if (view === "diagram") {
			const block = editor.getBlock(blockId);
			preview.update(block ? codeBlockText(block) : source);
		}
	}

	header.insertBefore(
		controls,
		header.querySelector(".haunter-code-block-expand"),
	);
	update();
	const unsubscribe = editor.onChange(update);
	let cursorBlockId = editor.getTextCursorPosition().block.id;
	const unsubscribeSelection = editor.onSelectionChange(() => {
		// Keyboard navigation into the block must never leave an invisible caret.
		const nextCursorBlockId = editor.getTextCursorPosition().block.id;
		const entering = cursorBlockId !== nextCursorBlockId;
		cursorBlockId = nextCursorBlockId;
		if (
			entering &&
			view === "diagram" &&
			editor.isEditable &&
			cursorBlockId === blockId
		) {
			view = "source";
			editorViews.set(blockId, view);
			update();
		}
	});
	return () => {
		unsubscribe();
		unsubscribeSelection();
		controls.removeEventListener("keydown", handleControlsKeyDown);
		viewControls.destroy();
		preview.destroy();
	};
}
