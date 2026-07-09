import "@beignet/core/server-only";
import { createProvider } from "@beignet/core/providers";
import webPush from "web-push";
import type { WebPushPort } from "@/features/notifications/ports";
import { env } from "@/lib/env";

const configured = Boolean(
	env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY && env.WEB_PUSH_SUBJECT,
);

if (configured) {
	webPush.setVapidDetails(
		env.WEB_PUSH_SUBJECT,
		env.WEB_PUSH_PUBLIC_KEY as string,
		env.WEB_PUSH_PRIVATE_KEY as string,
	);
}

export const webPushProvider = createProvider({
	name: "haunter-web-push",
	setup() {
		const webPushPort: WebPushPort = {
			isConfigured: () => configured,
			publicKey: () =>
				configured ? (env.WEB_PUSH_PUBLIC_KEY as string) : null,
			async send(subscription, message) {
				if (!configured) {
					return { status: "failed", reason: "Web Push is not configured." };
				}
				try {
					await webPush.sendNotification(
						{
							endpoint: subscription.endpoint,
							expirationTime: subscription.expirationTime ?? null,
							keys: subscription.keys,
						},
						JSON.stringify(message),
						{ TTL: 60 * 60 * 24 },
					);
					return { status: "sent" };
				} catch (error) {
					const statusCode =
						typeof error === "object" && error !== null && "statusCode" in error
							? Number(error.statusCode)
							: null;
					if (statusCode === 404 || statusCode === 410) {
						return { status: "gone" };
					}
					return {
						status: "failed",
						reason: error instanceof Error ? error.message : String(error),
					};
				}
			},
		};

		return { ports: { webPush: webPushPort } };
	},
});
