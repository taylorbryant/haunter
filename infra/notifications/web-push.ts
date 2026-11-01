import "@beignet/core/server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { ProviderInstrumentationTarget } from "@beignet/core/providers";
import {
	createWebPush,
	type WebPushClient,
	type WebPushVapidDetails,
} from "@beignet/provider-push-web";
import webPush from "web-push";
import type { WebPushPort } from "@/features/notifications/ports";
import { PushSubscriptionSchema } from "@/features/notifications/schemas";
import { isPublicAddress } from "@/infra/network/public-address";

type WebPushDependencies = {
	lookup?: typeof lookup;
	request?: typeof request;
	timeoutMs?: number;
	instrumentation?: ProviderInstrumentationTarget;
};

// Beignet owns payload/key validation, trusted service origins and safe delivery
// outcomes. Keep Haunter's DNS pinning and total deadline at the client boundary.
function createPublicWebPushClient(
	dependencies: WebPushDependencies,
): WebPushClient {
	return {
		async sendNotification(subscription, payload, options) {
			const controller = new AbortController();
			const deadline = new Promise<never>((_, reject) => {
				controller.signal.addEventListener(
					"abort",
					() => reject(new Error("Web Push delivery timed out.")),
					{ once: true },
				);
			});
			const timer = setTimeout(
				() => controller.abort(),
				dependencies.timeoutMs ?? 10_000,
			);
			try {
				const deliver = async () => {
					// Recheck DNS even for previously accepted subscriptions.
					const url = new URL(subscription.endpoint);
					const hostname = url.hostname.replace(/^\[|\]$/g, "");
					const addresses = isIP(hostname)
						? [{ address: hostname, family: isIP(hostname) }]
						: await (dependencies.lookup ?? lookup)(hostname, { all: true });
					if (
						!addresses.length ||
						addresses.some(({ address }) => !isPublicAddress(address))
					)
						throw new Error(
							"Web Push endpoint must resolve only to public IP addresses.",
						);
					// A DNS lookup can finish after the deadline. It must never start a late request.
					controller.signal.throwIfAborted();
					const selected = addresses[0]!;
					const details = webPush.generateRequestDetails(
						{ ...subscription, endpoint: url.href },
						payload,
						options,
					);
					return await new Promise<{ statusCode: number; headers: unknown }>(
						(resolve, reject) => {
							let receivedResponse = false;
							const interrupted = () =>
								reject(new Error("Web Push response interrupted."));
							const req = (dependencies.request ?? request)(
								url,
								{
									method: details.method,
									headers: details.headers,
									// Pin all checked answers, preserving address fallback and hostname TLS checks.
									agent: false,
									signal: controller.signal,
									lookup: (_host, options, callback) => {
										// Match DNS's async contract so TLS installs its error handlers first.
										queueMicrotask(() => {
											if (options.all) callback(null, addresses);
											else callback(null, selected.address, selected.family);
										});
									},
								},
								(res) => {
									receivedResponse = true;
									res.on("error", reject);
									res.once("end", () => {
										if (!res.complete) return interrupted();
										resolve({
											statusCode: res.statusCode ?? 0,
											headers: res.headers,
										});
									});
									res.once("close", () => {
										if (!res.complete) interrupted();
									});
									// Drain without buffering; the overall deadline also bounds the response.
									res.resume();
								},
							);
							req.on("error", reject);
							req.once("close", () => {
								if (!receivedResponse) interrupted();
							});
							req.end(details.body);
						},
					);
				};
				return await Promise.race([deliver(), deadline]);
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

/** Adapt the shared transport to Haunter's optional push configuration and inbox. */
export function createWebPushPort(
	vapidDetails: WebPushVapidDetails | undefined,
	dependencies: WebPushDependencies = {},
): WebPushPort {
	const transport = vapidDetails
		? createWebPush({
				vapid: vapidDetails,
				client: createPublicWebPushClient(dependencies),
				timeoutMs: dependencies.timeoutMs,
				instrumentation: dependencies.instrumentation,
			})
		: null;
	return {
		isConfigured: () => transport !== null,
		publicKey: () => vapidDetails?.publicKey ?? null,
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
