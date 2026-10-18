import { codeBlockText } from "@/features/pages/lib/mermaid";
import { mountMermaidPreview } from "./mermaid-preview";
import {
	type MermaidView,
	mountMermaidViewControls,
} from "./mermaid-view-controls";

type DiagramEditor = {
	readonly isEditable: boolean;
	isFocused(): boolean;
	getBlock(id: string): { type: string; content?: unknown } | undefined;
	onChange(callback: () => void): () => void;
	onSelectionChange(
		callback: () => void,
		includeSelectionChangedByRemote?: boolean,
	): () => void;
	onFocusChange(
		callback: (editor: DiagramEditor, context: { focused: boolean }) => void,
	): () => void;
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
	const revealSourceForCursor = () => {
		// Only content focus counts: header controls must keep Diagram selectable.
		// Restoring focus can keep the same block and selection entirely unchanged.
		if (
			view === "diagram" &&
			editor.isEditable &&
			editor.isFocused() &&
			editor.getTextCursorPosition().block.id === blockId
		) {
			view = "source";
			editorViews.set(blockId, view);
			update();
		}
	};
	// Remote edits can move the local selection without intending to edit source.
	const unsubscribeSelection = editor.onSelectionChange(
		revealSourceForCursor,
		false,
	);
	const unsubscribeFocus = editor.onFocusChange((_editor, { focused }) => {
		if (focused) revealSourceForCursor();
	});
	return () => {
		unsubscribe();
		unsubscribeSelection();
		unsubscribeFocus();
		controls.removeEventListener("keydown", handleControlsKeyDown);
		viewControls.destroy();
		preview.destroy();
	};
}
