/** Controls in a block (language pickers, file buttons, nested editors) do not
 * describe the page's ProseMirror selection. Browser blur is handled separately. */
export function isPageContextTarget(target: Element) {
	const page = target.closest("[data-live-context-page]");
	if (!page || target.closest("[data-live-context-canvas]")) return false;
	if (target.closest("input, textarea, select, button")) return false;
	// A non-text block can still be selected by ProseMirror. Its renderer opts
	// in explicitly so controls in other non-editable regions stay excluded.
	if (target.closest("[data-live-context-selectable]")) return true;
	const region = target.closest("[contenteditable]");
	return region === page || region?.getAttribute("contenteditable") !== "false";
}
