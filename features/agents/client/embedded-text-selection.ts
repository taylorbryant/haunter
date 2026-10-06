import { MAX_SELECTION_CHARACTERS } from "../mcp-app/editor-schema";

/** Only selections inside this page are shared; transient drag updates are coalesced. */
export function observeEmbeddedTextSelection(
	pageId: string,
	onChange: (selection: { text: string; complete: boolean }) => void,
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let previous = "";
	const publish = () => {
		const selection = window.getSelection();
		const parent = (node: Node | null) =>
			node instanceof Element ? node : node?.parentElement;
		const anchorElement = parent(selection?.anchorNode ?? null);
		const focusElement = parent(selection?.focusNode ?? null);
		const anchor = anchorElement?.closest("[data-haunter-editor-page]");
		const focus = focusElement?.closest("[data-haunter-editor-page]");
		const text =
			anchor?.getAttribute("data-haunter-editor-page") === pageId &&
			anchor === focus &&
			!anchorElement?.closest(".haunter-canvas") &&
			!focusElement?.closest(".haunter-canvas")
				? (selection?.toString().trim() ?? "")
				: "";
		const value = {
			text: text.slice(0, MAX_SELECTION_CHARACTERS),
			complete: text.length <= MAX_SELECTION_CHARACTERS,
		};
		const signature = JSON.stringify(value);
		if (signature === previous) return;
		previous = signature;
		onChange(value);
	};
	const changed = () => {
		clearTimeout(timer);
		timer = setTimeout(publish, 120);
	};
	document.addEventListener("selectionchange", changed);
	return () => {
		clearTimeout(timer);
		document.removeEventListener("selectionchange", changed);
	};
}
