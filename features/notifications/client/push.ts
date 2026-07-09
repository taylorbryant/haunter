import type { PushSubscriptionInput } from "@/features/notifications/schemas";

function urlBase64ToUint8Array(value: string) {
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = window.atob(base64);
	return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function pushAvailable() {
	return (
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

export async function currentPushSubscription() {
	if (!pushAvailable()) return null;
	const registration = await navigator.serviceWorker.ready;
	return registration.pushManager.getSubscription();
}

export function serializePushSubscription(
	subscription: PushSubscription,
): PushSubscriptionInput {
	const value = subscription.toJSON();
	if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) {
		throw new Error("The browser returned an incomplete push subscription.");
	}
	return {
		endpoint: value.endpoint,
		expirationTime: value.expirationTime ?? null,
		keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
	};
}

export async function enablePush(publicKey: string) {
	if (!pushAvailable())
		throw new Error("Push is not available on this device.");
	const permission = await Notification.requestPermission();
	if (permission !== "granted") {
		throw new Error("Notification permission was not granted.");
	}
	const registration = await navigator.serviceWorker.ready;
	const existing = await registration.pushManager.getSubscription();
	return (
		existing ??
		(await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(publicKey),
		}))
	);
}
