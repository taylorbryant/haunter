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

self.addEventListener("push", (event) => {
	let payload = {};
	try {
		payload = event.data?.json() ?? {};
	} catch {
		payload = {};
	}
	const title = typeof payload.title === "string" ? payload.title : "Haunter";
	const body =
		typeof payload.body === "string"
			? payload.body
			: "You have a new notification.";
	const url =
		typeof payload.url === "string" && payload.url.startsWith("/")
			? payload.url
			: "/";
	const tag = typeof payload.tag === "string" ? payload.tag : "haunter";
	const unreadCount =
		typeof payload.unreadCount === "number" ? payload.unreadCount : undefined;

	event.waitUntil(
		Promise.all([
			self.registration.showNotification(title, {
				body,
				icon: "/icons/icon-192.png",
				badge: "/icons/icon-192.png",
				tag,
				renotify: false,
				data: { url },
			}),
			unreadCount && "setAppBadge" in self.navigator
				? self.navigator.setAppBadge(unreadCount)
				: Promise.resolve(),
			self.clients
				.matchAll({ type: "window", includeUncontrolled: true })
				.then((clients) => {
					for (const client of clients) {
						client.postMessage({ type: "haunter:push-received" });
					}
				}),
		]),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const path =
		typeof event.notification.data?.url === "string" &&
		event.notification.data.url.startsWith("/")
			? event.notification.data.url
			: "/";
	const destination = new URL(path, self.location.origin).href;
	event.waitUntil(
		self.clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then(async (clients) => {
				const existing = clients.find(
					(client) => new URL(client.url).origin === self.location.origin,
				);
				if (existing) {
					await existing.navigate(destination);
					return existing.focus();
				}
				return self.clients.openWindow(destination);
			}),
	);
});
