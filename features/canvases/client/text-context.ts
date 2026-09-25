import type { Editor } from "tldraw";
import {
	type CanvasTextEditing,
	LIVE_CONTEXT_MAX_SELECTED_TEXT,
} from "@/features/live-context/schemas";

/** Read tldraw's own text selection, not the document-wide DOM selection (which
 * can belong to another canvas or the page editor). Positions describe the
 * current ProseMirror document, including structural tokens, not string offsets. */
export function readCanvasTextEditing(
	editor: Editor,
): CanvasTextEditing | null {
	const shape = editor.getEditingShape();
	if (!shape || !("richText" in shape.props)) return null;
	const textEditor = editor.getRichTextEditor();
	const editing: CanvasTextEditing = { shapeId: shape.id, selection: null };
	if (!textEditor || textEditor.isDestroyed) return editing;
	const { doc, selection } = textEditor.state;
	const kind = selection.toJSON().type;
	if (kind !== "text" && kind !== "all") return editing;
	const { anchor, head, from, to } = selection;
	const text = doc.textBetween(from, to, "\n", (node) =>
		node.type.name === "hardBreak" ? "\n" : "\ufffc",
	);
	let selectedText = text.slice(0, LIVE_CONTEXT_MAX_SELECTED_TEXT);
	// Do not split an emoji/supplementary code point at the UTF-16 size limit.
	if (
		selectedText.length < text.length &&
		/[\uD800-\uDBFF]$/.test(selectedText)
	) {
		selectedText = selectedText.slice(0, -1);
	}
	editing.selection = {
		coordinateSystem: "prosemirror",
		kind,
		anchor,
		head,
		from,
		to,
		selectedText,
		truncated: selectedText.length < text.length,
	};
	return editing;
}
