"use client";

import { useEffect, useState } from "react";

const IDLE_TIMEOUT_MS = 1_500;

export function useAfterFirstPaint() {
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let idleId: number | null = null;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const frameId = window.requestAnimationFrame(() => {
			if ("requestIdleCallback" in window) {
				idleId = window.requestIdleCallback(() => setReady(true), {
					timeout: IDLE_TIMEOUT_MS,
				});
				return;
			}
			timeoutId = globalThis.setTimeout(() => setReady(true), 0);
		});

		return () => {
			window.cancelAnimationFrame(frameId);
			if (idleId !== null) window.cancelIdleCallback(idleId);
			if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
		};
	}, []);

	return ready;
}
