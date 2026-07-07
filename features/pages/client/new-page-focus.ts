"use client";

/**
 * One-shot handoff between "create page" actions and the editor: creation
 * paths mark the new page's id before navigating, and PageEditor consumes
 * the mark on arrival to focus the empty title input. Module state instead
 * of a URL param keeps refreshes and shared links from re-stealing focus.
 */
let pendingFocusPageId: string | null = null;
let keyboardPrimeInput: HTMLInputElement | null = null;
let keyboardPrimeTimeout: ReturnType<typeof setTimeout> | null = null;

export function focusTitleOnArrival(pageId: string) {
	pendingFocusPageId = pageId;
}

export function consumeTitleFocus(pageId: string): boolean {
	if (pendingFocusPageId !== pageId) return false;
	pendingFocusPageId = null;
	return true;
}

export function primeTitleKeyboard() {
	if (typeof window === "undefined" || typeof document === "undefined") return;
	if (!window.matchMedia("(max-width: 767px)").matches) return;
	if (window.navigator.maxTouchPoints < 1) return;

	// Mobile browsers only open the virtual keyboard from a trusted tap/click.
	// Focus this temporary input synchronously, then transfer focus on arrival.
	if (!keyboardPrimeInput) {
		keyboardPrimeInput = document.createElement("input");
		keyboardPrimeInput.type = "text";
		keyboardPrimeInput.autocomplete = "off";
		keyboardPrimeInput.setAttribute("aria-label", "New page title");
		keyboardPrimeInput.setAttribute("data-haunter-keyboard-prime", "true");
		Object.assign(keyboardPrimeInput.style, {
			position: "fixed",
			top: "0",
			left: "0",
			width: "1px",
			height: "1px",
			margin: "0",
			border: "0",
			padding: "0",
			opacity: "0.01",
			fontSize: "16px",
			pointerEvents: "none",
			zIndex: "-1",
		});
		document.body.append(keyboardPrimeInput);
	}

	keyboardPrimeInput.focus({ preventScroll: true });
	keyboardPrimeInput.setSelectionRange(0, 0);
	if (keyboardPrimeTimeout) clearTimeout(keyboardPrimeTimeout);
	keyboardPrimeTimeout = setTimeout(releaseTitleKeyboardPrime, 10_000);
}

export function releaseTitleKeyboardPrime() {
	if (keyboardPrimeTimeout) {
		clearTimeout(keyboardPrimeTimeout);
		keyboardPrimeTimeout = null;
	}
	keyboardPrimeInput?.remove();
	keyboardPrimeInput = null;
}
