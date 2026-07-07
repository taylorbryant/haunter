"use client";

import { useEffect } from "react";

/**
 * Registers the minimal service worker that makes the app installable. Renders
 * nothing. The worker caches nothing (see public/sw.js), so this is safe in
 * every environment and never interferes with HMR or serves stale content.
 */
export function ServiceWorkerRegistrar() {
	useEffect(() => {
		if (!("serviceWorker" in navigator)) return;
		const register = () => {
			navigator.serviceWorker.register("/sw.js").catch(() => {
				// Registration is best-effort: failure just means no install prompt.
			});
		};
		if (document.readyState === "complete") {
			register();
			return;
		}
		window.addEventListener("load", register, { once: true });
		return () => window.removeEventListener("load", register);
	}, []);

	return null;
}
