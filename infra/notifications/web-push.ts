import "@beignet/core/server-only";
import {
	createWebPush,
	type CreateWebPushOptions,
	type WebPushVapidDetails,
} from "@beignet/provider-push-web";
import type { WebPushPort } from "@/features/notifications/ports";
import { PushSubscriptionSchema } from "@/features/notifications/schemas";

type WebPushDependencies = Pick<
	CreateWebPushOptions,
	"timeoutMs" | "instrumentation"
>;

/** Adapt the shared transport to Haunter's optional push configuration and inbox. */
export function createWebPushPort(
	vapidDetails: WebPushVapidDetails | undefined,
	dependencies: WebPushDependencies = {},
): WebPushPort {
	const transport = vapidDetails
		? createWebPush({
				vapid: vapidDetails,
				timeoutMs: dependencies.timeoutMs,
				instrumentation: dependencies.instrumentation,
			})
		: null;
	return {
		isConfigured: () => transport !== null,
		publicKey: () => vapidDetails?.publicKey ?? null,
		validateSubscription(subscription) {
			const parsed = PushSubscriptionSchema.safeParse(subscription);
			if (!parsed.success)
				return { valid: false, reason: "invalid-subscription" };
			return (
				transport?.validateSubscription(parsed.data) ?? {
					valid: false,
					reason: "unsupported-service",
				}
			);
		},
		async send(subscription, message) {
			if (!transport)
				return { status: "failed", reason: "Web Push is not configured." };
			// Preserve stricter URL syntax checks for persisted and newly registered devices.
			const parsed = PushSubscriptionSchema.safeParse(subscription);
			if (!parsed.success)
				return { status: "failed", reason: "invalid-request" };
			const result = await transport.send({
				subscription: parsed.data,
				payload: message,
				ttlSeconds: 86_400,
			});
			return result.status === "accepted" ? { status: "sent" } : result;
		},
	};
}
