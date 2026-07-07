// Minimal service worker: it exists only to satisfy PWA installability —
// Chrome desktop requires a registered service worker with a fetch handler to
// offer a real install. It caches NOTHING; every request goes straight to the
// network, so there is no offline behavior and no cache to version or purge.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
	event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", () => {
	// Intentionally empty. The presence of a fetch handler is the install
	// criterion; not calling respondWith lets the browser handle every request
	// normally (no interception, no caching).
});
