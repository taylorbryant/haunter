"use client";

/**
 * One-shot handoff between "create page" actions and the editor: creation
 * paths mark the new page's id before navigating, and PageEditor consumes
 * the mark on arrival to focus the empty title input. Module state instead
 * of a URL param keeps refreshes and shared links from re-stealing focus.
 */
let pendingFocusPageId: string | null = null;

export function focusTitleOnArrival(pageId: string) {
	pendingFocusPageId = pageId;
}

export function consumeTitleFocus(pageId: string): boolean {
	if (pendingFocusPageId !== pageId) return false;
	pendingFocusPageId = null;
	return true;
}
