import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createECDH, randomBytes } from "node:crypto";
import dns, { type lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import https, { type request, type RequestOptions } from "node:https";
import { Readable } from "node:stream";
import webPush from "web-push";
import { documentFixture } from "@/features/documents/tests/helpers";
import { createWebPushPort } from "@/infra/notifications/web-push";
import type { StoredPushSubscription, WebPushMessage } from "../ports";
import { PushSubscriptionSchema } from "../schemas";
import {
	getPushSubscriptionStatusUseCase,
	subscribePushUseCase,
	testPushUseCase,
	unsubscribePushUseCase,
} from "../use-cases/manage-push-subscriptions";

const vapidDetails = {
	...webPush.generateVAPIDKeys(),
	subject: "mailto:test@example.test",
};
const receiver = createECDH("prime256v1");
receiver.generateKeys();
const keys = {
	p256dh: receiver.getPublicKey().toString("base64url"),
	auth: randomBytes(16).toString("base64url"),
};
const message: WebPushMessage = {
	title: "Reminder",
	body: "Review the patch",
	url: "/",
	tag: "test",
	unreadCount: 1,
};
function subscription(
	endpoint = "https://fcm.googleapis.com/fcm/send/test-token",
): StoredPushSubscription {
	return {
		id: "push-test",
		userId: "user-test",
		createdAt: "2026-10-21T00:00:00Z",
		updatedAt: "2026-10-21T00:00:00Z",
		endpoint,
		keys,
		expirationTime: null,
	};
}

type Address = { address: string; family: number };
afterEach(() => mock.restore());

function transportFixture(
	options: {
		addresses?: Address[];
		lookup?: typeof lookup;
		status?: number;
		stall?: boolean;
		error?: Error;
		interrupted?: boolean;
		timeoutMs?: number;
	} = {},
) {
	const lookups: string[] = [];
	const calls: {
		url: URL;
		options: RequestOptions;
		body: Buffer;
		pinned: unknown[];
	}[] = [];
	const responses: IncomingMessage[] = [];
	let aborts = 0;
	const resolve = (async (host: string) => {
		lookups.push(host);
		return options.addresses ?? [{ address: "1.1.1.1", family: 4 }];
	}) as unknown as typeof lookup;
	const connect = ((
		url: URL,
		settings: RequestOptions,
		callback: (res: IncomingMessage) => void,
	) => {
		const req = new EventEmitter() as EventEmitter & {
			end(body: Buffer): void;
		};
		settings.signal!.addEventListener(
			"abort",
			() => {
				aborts++;
				req.emit("error", new Error("Request aborted"));
			},
			{ once: true },
		);
		req.end = (body) => {
			const pinned: unknown[] = [];
			const pinnedLookup = settings.lookup as unknown as (
				host: string,
				options: { all: boolean },
				callback: (error: unknown, result: unknown, family?: number) => void,
			) => void;
			for (const all of [true, false]) {
				pinnedLookup(url.hostname, { all }, (error, address, family) => {
					expect(error).toBeNull();
					pinned.push(all ? address : { address, family });
				});
			}
			calls.push({ url, options: settings, body, pinned });
			queueMicrotask(() => {
				if (options.error) {
					req.emit("error", options.error);
					return;
				}
				if (options.stall) return;
				const response = new Readable({
					read() {
						if (options.interrupted) this.destroy();
						else this.push(null);
					},
				}) as IncomingMessage;
				response.statusCode = options.status ?? 201;
				response.complete = !options.interrupted;
				response.headers = { location: "https://127.0.0.1/private" };
				responses.push(response);
				callback(response);
			});
		};
		return req;
	}) as unknown as typeof request;
	// Exercise Beignet's built-in client through Haunter's port. Mock only I/O;
	// production no longer supplies its own transport or network-policy hooks.
	spyOn(dns, "lookup").mockImplementation(options.lookup ?? resolve);
	spyOn(https, "request").mockImplementation(connect);
	const dependencies = { timeoutMs: options.timeoutMs };
	return {
		port: createWebPushPort(vapidDetails, dependencies),
		dependencies,
		calls,
		lookups,
		responses,
		get aborts() {
			return aborts;
		},
	};
}

test.each([
	"https://127.0.0.1:9443/internal-review-fixture",
	"https://127.0.0.1/",
	"https://127.1/",
	"https://2130706433/",
	"https://0x7f000001/",
	"https://0177.0.0.1/",
	"https://%31%32%37.0.0.1/",
	"https://10.0.0.1/",
	"https://172.16.0.1/",
	"https://192.168.1.1/",
	"https://100.64.0.1/",
	"https://169.254.169.254/",
	"https://0.0.0.0/",
	"https://224.0.0.1/",
	"https://192.0.2.1/",
	"https://[::1]/",
	"https://[::]/",
	"https://[::ffff:127.0.0.1]/",
	"https://[fd00::1]/",
	"https://[fe80::1]/",
	"https://[2002:7f00:1::]/",
])(
	"push blocks unsafe stored endpoint without a network request: %s",
	async (endpoint) => {
		const f = transportFixture();
		expect((await f.port.send(subscription(endpoint), message)).status).toBe(
			"failed",
		);
		expect(f.calls).toHaveLength(0);
		expect(f.lookups).toHaveLength(0);
	},
);

test.each([
	"not a url",
	"http://push.example/test",
	"ftp://push.example/test",
	"https://u:p@push.example/test",
	"https://push.example:8443/test",
	"https://push.example/test#fragment",
	"https://push.example/test#",
	" https://push.example/test",
	"https://push.example/\ttest",
	"https://push.example\\test",
])(
	"push rejects malformed or unsupported URLs at registration and send: %s",
	async (endpoint) => {
		expect(
			PushSubscriptionSchema.safeParse(subscription(endpoint)).success,
		).toBe(false);
		const f = transportFixture();
		expect((await f.port.send(subscription(endpoint), message)).status).toBe(
			"failed",
		);
		expect(f.lookups).toHaveLength(0);
		expect(f.calls).toHaveLength(0);
	},
);

test.each(
	(
		[
			[],
			[{ address: "127.0.0.1", family: 4 }],
			[
				{ address: "1.1.1.1", family: 4 },
				{ address: "169.254.169.254", family: 4 },
			],
			[
				{ address: "2606:4700:4700::1111", family: 6 },
				{ address: "fd00::1", family: 6 },
			],
			[{ address: "::ffff:10.0.0.1", family: 6 }],
		] as Address[][]
	).map((addresses) => ({ addresses })),
)(
	"push fails closed for empty, private, or mixed DNS answers: %j",
	async ({ addresses }) => {
		const f = transportFixture({ addresses });
		expect((await f.port.send(subscription(), message)).status).toBe("failed");
		expect(f.calls).toHaveLength(0);
	},
);

test.each([
	"https://FCM.GOOGLEAPIS.COM:443/fcm/send/a%2Fb?token=x%2By",
	"https://updates.push.services.mozilla.com/wpush/v2/test-token",
	"https://web.push.apple.com/test-token",
	"https://wns2-db5p.notify.windows.com/w/?token=a%2Fb%2Bc",
	"https://WNS2-AM3P.NOTIFY.WINDOWS.COM:443/w/?token=test",
])(
	"public push keeps encrypted payload, VAPID and opaque endpoint tokens: %s",
	async (endpoint) => {
		const f = transportFixture();
		expect(
			PushSubscriptionSchema.safeParse(subscription(endpoint)).success,
		).toBe(true);
		expect(await f.port.send(subscription(endpoint), message)).toEqual({
			status: "sent",
		});
		expect(f.lookups).toEqual([new URL(endpoint).hostname]);
		const call = f.calls[0]!;
		expect(call.url.href).toBe(new URL(endpoint).href);
		expect(call.options.agent).toBe(false);
		expect(call.options.method).toBe("POST");
		expect(call.options.rejectUnauthorized).not.toBe(false);
		expect(call.pinned).toEqual([
			[{ address: "1.1.1.1", family: 4 }],
			{ address: "1.1.1.1", family: 4 },
		]);
		const headers = call.options.headers as Record<string, string>;
		expect(String(headers.TTL)).toBe("86400");
		expect(headers["Content-Encoding"]).toBe("aes128gcm");
		expect(Number(headers["Content-Length"])).toBe(call.body.length);
		expect(call.body.includes(Buffer.from(message.body))).toBe(false);
		const token = headers.Authorization!.match(/^vapid t=([^,]+), k=/)![1]!;
		expect(
			JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).aud,
		).toBe(new URL(endpoint).origin);
		expect(f.responses[0]!.destroyed).toBe(true);
	},
);

test("push retains all checked addresses for IPv6/IPv4 connection fallback", async () => {
	const addresses = [
		{ address: "2606:4700:4700::1111", family: 6 },
		{ address: "1.1.1.1", family: 4 },
	];
	const f = transportFixture({ addresses });
	expect(await f.port.send(subscription(), message)).toEqual({
		status: "sent",
	});
	expect(f.calls[0]!.pinned).toEqual([addresses, addresses[0]]);
	expect(f.lookups).toHaveLength(1);
});

test("pinned DNS defers connection errors until HTTPS installs its handlers", async () => {
	const f = transportFixture();
	const connect = ((url: URL, settings: RequestOptions) => {
		const req = new EventEmitter() as EventEmitter & { end(): void };
		req.end = () => {};
		let requestReturned = false;
		const pinnedLookup = settings.lookup as unknown as (
			host: string,
			options: { all: boolean },
			callback: () => void,
		) => void;
		pinnedLookup(url.hostname, { all: true }, () => {
			expect(requestReturned).toBe(true);
			req.emit("error", new Error("Network unreachable"));
		});
		requestReturned = true;
		return req;
	}) as unknown as typeof request;
	spyOn(https, "request").mockImplementation(connect);
	const port = createWebPushPort(vapidDetails, f.dependencies);
	expect(await port.send(subscription(), message)).toEqual({
		status: "failed",
		reason: "unavailable",
		retryable: true,
	});
});

test("public IPv6 DNS works, each delivery rechecks DNS, and literal origins are rejected", async () => {
	const addresses = [{ address: "2606:4700:4700::1111", family: 6 }];
	const f = transportFixture({ addresses });
	expect(await f.port.send(subscription(), message)).toEqual({
		status: "sent",
	});
	expect(f.calls[0]!.pinned[0]).toEqual(addresses);
	addresses[0] = { address: "::1", family: 6 };
	expect((await f.port.send(subscription(), message)).status).toBe("failed");
	expect(f.lookups).toHaveLength(2);
	expect(f.calls).toHaveLength(1);
	for (const endpoint of [
		"https://1.1.1.1/push",
		"https://[2606:4700:4700::1111]/push",
	]) {
		const literal = transportFixture();
		expect(await literal.port.send(subscription(endpoint), message)).toEqual({
			status: "failed",
			reason: "invalid-request",
			retryable: false,
		});
		expect(literal.calls).toHaveLength(0);
		expect(literal.lookups).toHaveLength(0);
	}
});

test.each([200, 201, 204, 301, 302, 307, 308, 400, 404, 410, 429, 500])(
	"push preserves HTTP %i semantics without buffering bodies or following redirects",
	async (status) => {
		const f = transportFixture({ status });
		const expected =
			status >= 200 && status < 300
				? "sent"
				: status === 404 || status === 410
					? "gone"
					: "failed";
		expect((await f.port.send(subscription(), message)).status).toBe(expected);
		expect(f.calls).toHaveLength(1);
		expect(f.responses[0]!.destroyed).toBe(true);
	},
);

test("push deadline covers stalled DNS and prevents a request after late resolution", async () => {
	let finish!: (addresses: Address[]) => void;
	const f = transportFixture({
		lookup: (() =>
			new Promise<Address[]>((resolve) => {
				finish = resolve;
			})) as unknown as typeof lookup,
		timeoutMs: 20,
	});
	expect(await f.port.send(subscription(), message)).toEqual({
		status: "failed",
		reason: "unavailable",
		retryable: true,
	});
	finish([{ address: "1.1.1.1", family: 4 }]);
	await Promise.resolve();
	await Promise.resolve();
	expect(f.calls).toHaveLength(0);
});

test("push deadline aborts an active stalled request", async () => {
	const f = transportFixture({ stall: true, timeoutMs: 20 });
	expect(await f.port.send(subscription(), message)).toEqual({
		status: "failed",
		reason: "unavailable",
		retryable: true,
	});
	expect(f.aborts).toBe(1);
	expect(f.calls[0]!.options.signal!.aborted).toBe(true);
});

test("DNS, TLS/network, bad key and unconfigured failures remain failed", async () => {
	const dns = transportFixture({
		lookup: (async () => {
			throw new Error("DNS failure");
		}) as typeof lookup,
	});
	expect(await dns.port.send(subscription(), message)).toEqual({
		status: "failed",
		reason: "unavailable",
		retryable: true,
	});
	expect(dns.calls).toHaveLength(0);
	const network = transportFixture({ error: new Error("TLS failure") });
	expect(await network.port.send(subscription(), message)).toEqual({
		status: "failed",
		reason: "unavailable",
		retryable: true,
	});
	const badKeys = transportFixture();
	expect(
		(
			await badKeys.port.send(
				{ ...subscription(), keys: { p256dh: "bad", auth: "bad" } },
				message,
			)
		).status,
	).toBe("failed");
	expect(badKeys.calls).toHaveLength(0);
	const unconfigured = createWebPushPort(undefined, badKeys.dependencies);
	expect(unconfigured.isConfigured()).toBe(false);
	expect(unconfigured.publicKey()).toBeNull();
	expect((await unconfigured.send(subscription(), message)).status).toBe(
		"failed",
	);
	expect(badKeys.port.isConfigured()).toBe(true);
	expect(badKeys.port.publicKey()).toBe(vapidDetails.publicKey);
});

test("test-push blocks persisted unsafe subscriptions and still allows removing them", async () => {
	const f = await documentFixture();
	const transport = transportFixture({
		addresses: [{ address: "127.0.0.1", family: 4 }],
	});
	f.ctx.ports.webPush = transport.port;
	try {
		for (const endpoint of [
			"https://127.0.0.1:9443/internal-review-fixture",
			"https://private.example/push",
		]) {
			await f.database.repositories.notificationInbox.upsertPushSubscription(
				f.userId,
				subscription(endpoint),
			);
			await expect(
				testPushUseCase.run({ ctx: f.ctx, input: { endpoint } }),
			).rejects.toMatchObject({
				code: endpoint.includes("127.0.0.1")
					? "INVALID_PUSH_SUBSCRIPTION"
					: "UNSUPPORTED_PUSH_SERVICE",
			});
			expect(
				await unsubscribePushUseCase.run({ ctx: f.ctx, input: { endpoint } }),
			).toEqual({ subscribed: false });
			expect(
				await f.database.repositories.notificationInbox.findPushSubscription(
					f.userId,
					endpoint,
				),
			).toBeNull();
		}
		expect(transport.calls).toHaveLength(0);
	} finally {
		await f.database.close();
	}
});

test.each([
	"https://fcm.googleapis.com/fcm/send/test-token",
	"https://wns2-db5p.notify.windows.com/w/?token=test",
])(
	"registration and test-push deliver and remove expired subscriptions: %s",
	async (endpoint) => {
		const f = await documentFixture();
		const input = subscription(endpoint);
		try {
			for (const status of [201, 404, 410]) {
				const transport = transportFixture({ status });
				f.ctx.ports.webPush = transport.port;
				expect(await subscribePushUseCase.run({ ctx: f.ctx, input })).toEqual({
					subscribed: true,
				});
				expect(
					await testPushUseCase.run({
						ctx: f.ctx,
						input: { endpoint: input.endpoint },
					}),
				).toEqual({ sent: status === 201 });
				const stored =
					await f.database.repositories.notificationInbox.findPushSubscription(
						f.userId,
						input.endpoint,
					);
				expect(Boolean(stored)).toBe(status === 201);
				expect(transport.calls).toHaveLength(1);
			}
		} finally {
			await f.database.close();
		}
	},
);

test("push rejects untrusted service origins and oversized payloads before DNS", async () => {
	const f = transportFixture();
	for (const [device, payload] of [
		[subscription("https://push.example/send"), message],
		[subscription("https://fcm.googleapis.com.evil.example/send"), message],
		[subscription("https://evilnotify.windows.com/w/?token=test"), message],
		[
			subscription("https://notify.windows.com.attacker.test/w/?token=test"),
			message,
		],
		[subscription("https://notify.windows.com/w/?token=test"), message],
		[subscription(), { ...message, body: "a".repeat(4_000) }],
	] as const) {
		expect(await f.port.send(device, payload)).toEqual({
			status: "failed",
			reason: "invalid-request",
			retryable: false,
		});
	}
	expect(f.lookups).toHaveLength(0);
	expect(f.calls).toHaveLength(0);
});

test("WNS delivery still rejects mixed public and private DNS answers", async () => {
	const f = transportFixture({
		addresses: [
			{ address: "1.1.1.1", family: 4 },
			{ address: "127.0.0.1", family: 4 },
		],
	});
	expect(
		(
			await f.port.send(
				subscription("https://wns2-db5p.notify.windows.com/w/?token=test"),
				message,
			)
		).status,
	).toBe("failed");
	expect(f.lookups).toEqual(["wns2-db5p.notify.windows.com"]);
	expect(f.calls).toHaveLength(0);
});

test.each([201, 410])(
	"interrupted HTTP %i responses remain retryable instead of accepting or deleting a device",
	async (status) => {
		const f = transportFixture({ status, interrupted: true });
		expect(await f.port.send(subscription(), message)).toEqual({
			status: "failed",
			reason: "unavailable",
			retryable: true,
		});
		expect(f.calls).toHaveLength(1);
		expect(f.responses[0]!.destroyed).toBe(true);
	},
);

test("registration rejects unsupported services and malformed keys before storage or delivery", async () => {
	const f = await documentFixture();
	const transport = transportFixture();
	f.ctx.ports.webPush = transport.port;
	try {
		for (const [input, code] of [
			[
				subscription("https://push.example.test/send"),
				"UNSUPPORTED_PUSH_SERVICE",
			],
			[
				{ ...subscription(), keys: { ...keys, auth: "bad" } },
				"INVALID_PUSH_SUBSCRIPTION",
			],
			[
				{
					...subscription("https://push.example.test/send"),
					keys: { ...keys, auth: "bad" },
				},
				"INVALID_PUSH_SUBSCRIPTION",
			],
		] as const) {
			await expect(
				subscribePushUseCase.run({ ctx: f.ctx, input }),
			).rejects.toMatchObject({ code });
			expect(
				await f.database.repositories.notificationInbox.findPushSubscription(
					f.userId,
					input.endpoint,
				),
			).toBeNull();
		}
		expect(transport.lookups).toHaveLength(0);
		expect(transport.calls).toHaveLength(0);
	} finally {
		await f.database.close();
	}
});

test("saved device status validates the current user's subscription without sending", async () => {
	const f = await documentFixture();
	const transport = transportFixture();
	f.ctx.ports.webPush = transport.port;
	try {
		const input = subscription(
			"https://wns2-db5p.notify.windows.com/w/?token=test",
		);
		const status = () =>
			getPushSubscriptionStatusUseCase.run({
				ctx: f.ctx,
				input: { endpoint: input.endpoint },
			});
		expect(await status()).toEqual({ status: "disabled" });
		await subscribePushUseCase.run({ ctx: f.ctx, input });
		expect(await status()).toEqual({ status: "enabled" });
		expect(
			await getPushSubscriptionStatusUseCase.run({
				ctx: {
					...f.ctx,
					auth: {
						...f.ctx.auth!,
						user: { ...f.ctx.auth!.user, id: "another-user" },
					},
				},
				input: { endpoint: input.endpoint },
			}),
		).toEqual({ status: "disabled" });
		await expect(
			getPushSubscriptionStatusUseCase.run({
				ctx: { ...f.ctx, auth: null },
				input: { endpoint: input.endpoint },
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		f.ctx.ports.webPush = createWebPushPort(undefined);
		expect(await status()).toEqual({ status: "unavailable" });
		expect(transport.lookups).toHaveLength(0);
		expect(transport.calls).toHaveLength(0);
	} finally {
		await f.database.close();
	}
});

test.each([
	["https://push.example.test/send", keys, "unsupported-service"],
	[
		"https://fcm.googleapis.com/fcm/send/test-token",
		{ ...keys, auth: "bad" },
		"invalid-subscription",
	],
] as const)(
	"existing unusable subscriptions have an actionable status and remain removable: %s",
	async (endpoint, storedKeys, expected) => {
		const f = await documentFixture();
		const transport = transportFixture();
		f.ctx.ports.webPush = transport.port;
		try {
			await f.database.repositories.notificationInbox.upsertPushSubscription(
				f.userId,
				{ ...subscription(endpoint), keys: storedKeys },
			);
			expect(
				await getPushSubscriptionStatusUseCase.run({
					ctx: f.ctx,
					input: { endpoint },
				}),
			).toEqual({ status: expected });
			await unsubscribePushUseCase.run({ ctx: f.ctx, input: { endpoint } });
			expect(
				await getPushSubscriptionStatusUseCase.run({
					ctx: f.ctx,
					input: { endpoint },
				}),
			).toEqual({ status: "disabled" });
			expect(transport.lookups).toHaveLength(0);
			expect(transport.calls).toHaveLength(0);
		} finally {
			await f.database.close();
		}
	},
);

test("mismatched VAPID keys fail before sending", () => {
	expect(() =>
		createWebPushPort({
			...vapidDetails,
			publicKey: webPush.generateVAPIDKeys().publicKey,
		}),
	).toThrow("matching P-256 key pair");
});
