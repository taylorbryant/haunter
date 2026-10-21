import "@beignet/core/server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import webPush from "web-push";
import type { WebPushPort } from "@/features/notifications/ports";
import { PushSubscriptionSchema } from "@/features/notifications/schemas";
import { isPublicAddress } from "@/infra/network/public-address";

type VapidDetails = NonNullable<webPush.RequestOptions["vapidDetails"]>;

export function createWebPushPort(
	vapidDetails: VapidDetails | undefined,
	dependencies: {
		lookup?: typeof lookup;
		request?: typeof request;
		timeoutMs?: number;
	} = {},
): WebPushPort {
	return {
		isConfigured: () => Boolean(vapidDetails),
		publicKey: () => vapidDetails?.publicKey ?? null,
		async send(subscription, message) {
			if (!vapidDetails)
				return { status: "failed", reason: "Web Push is not configured." };

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
					// Revalidate persisted subscriptions on every delivery, not just at registration.
					const input = PushSubscriptionSchema.parse(subscription);
					const url = new URL(input.endpoint);
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
						{ ...input, endpoint: url.href },
						JSON.stringify(message),
						{ TTL: 60 * 60 * 24, vapidDetails },
					);
					return await new Promise<number>((resolve, reject) => {
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
								// Push needs only a status. Do not buffer untrusted bodies or follow redirects.
								resolve(res.statusCode ?? 0);
								res.destroy();
							},
						);
						req.on("error", reject);
						req.end(details.body);
					});
				};
				const status = await Promise.race([deliver(), deadline]);
				if (status >= 200 && status < 300) return { status: "sent" };
				if (status === 404 || status === 410) return { status: "gone" };
				return {
					status: "failed",
					reason: `Web Push service returned HTTP ${status}.`,
				};
			} catch (error) {
				return {
					status: "failed",
					reason: error instanceof Error ? error.message : String(error),
				};
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
