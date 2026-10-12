"use client";

import { useCallback, useRef } from "react";

/** Return keyboard edits to their row without interrupting a blur/click elsewhere. */
export function useInlineEditFocus() {
	const pending = useRef<{
		input: HTMLElement;
		container: HTMLElement;
	} | null>(null);

	const requestReturn = useCallback((input: HTMLElement) => {
		if (input.parentElement)
			pending.current = { input, container: input.parentElement };
	}, []);

	const returnTargetRef = useCallback((target: HTMLElement | null) => {
		const request = pending.current;
		if (!target || target.parentElement !== request?.container) return;
		pending.current = null;
		const doc = target.ownerDocument;
		// Saving can be asynchronous. Respect any focus the user moved in the meantime.
		if (doc.activeElement === doc.body || doc.activeElement === request.input)
			target.focus({ preventScroll: true });
	}, []);

	return { requestReturn, returnTargetRef };
}
