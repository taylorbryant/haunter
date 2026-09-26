import type { EditorState } from "prosemirror-state";
import type { ResolvedPos } from "prosemirror-model";
import {
	type PageSelection,
	LIVE_CONTEXT_MAX_BLOCKS,
	LIVE_CONTEXT_MAX_SELECTED_TEXT,
} from "@/features/live-context/schemas";

function blockAt(position: ResolvedPos): string | null {
	for (let depth = position.depth; depth > 0; depth--) {
		const node = position.node(depth);
		if (node.type.isInGroup("bnBlock")) return node.attrs.id ?? null;
	}
	return null;
}

/** Reads the local document only; never dispatches a transaction or reads the
 * global DOM selection, which may belong to a nested canvas or another input. */
export function readPageSelection({
	doc,
	selection,
}: EditorState): PageSelection {
	const kind = selection.toJSON().type;
	const ids = new Set<string>();
	if (!selection.empty) {
		for (const { $from, $to } of selection.ranges) {
			doc.nodesBetween($from.pos, $to.pos, (node, _pos, parent) => {
				// Only the block's own content counts: selecting a nested child
				// must not implicitly select its ancestors' unselected text.
				if (node.type.isInGroup("blockContent") && parent?.attrs.id) {
					ids.add(parent.attrs.id);
				}
			});
		}
	}
	const activeBlockId =
		kind === "all" || kind === "multiple-node"
			? null
			: kind === "node" && selection.$from.nodeAfter?.type.isInGroup("bnBlock")
				? selection.$from.nodeAfter.attrs.id
				: blockAt(kind === "node" ? selection.$from : selection.$head);
	const context: PageSelection = {
		activeBlockId,
		selectedBlockIds: [...ids].slice(0, LIVE_CONTEXT_MAX_BLOCKS),
		selectionCount: ids.size,
		selection: null,
	};
	// Rectangular table and node selections cannot be represented by a single
	// text range. Preserve their block IDs without inventing selected text.
	if (kind !== "text" && kind !== "all") return context;
	const { anchor, head, from, to } = selection;
	const text = doc.textBetween(from, to, "\n", (node) =>
		node.type.name === "hardBreak" ? "\n" : "\ufffc",
	);
	let selectedText = text.slice(0, LIVE_CONTEXT_MAX_SELECTED_TEXT);
	if (
		selectedText.length < text.length &&
		/[\uD800-\uDBFF]$/.test(selectedText)
	) {
		selectedText = selectedText.slice(0, -1);
	}
	context.selection = {
		coordinateSystem: "prosemirror",
		kind,
		anchor,
		head,
		from,
		to,
		selectedText,
		truncated: selectedText.length < text.length,
	};
	return context;
}
