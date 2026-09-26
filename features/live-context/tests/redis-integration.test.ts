import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis as RedisConnection } from "ioredis";
import { Redis, type Requester } from "@upstash/redis";
import { createTenantScope } from "@beignet/core/ports";
import { createRedisLiveContext } from "@/infra/live-context/redis-live-context";
import { textEditingFixture, pageSelectionFixture } from "./helpers";
import {
	LIVE_CONTEXT_CLOCK_SKEW_MS,
	LIVE_CONTEXT_MAX_SESSIONS,
	LIVE_CONTEXT_REPORT_MAX_AGE_MS,
	LIVE_CONTEXT_SEQUENCE_TTL_MS,
	LIVE_CONTEXT_TTL_MS,
	type PublishContextInput,
} from "../schemas";

let directory: string | undefined;
let server: ReturnType<typeof Bun.spawn> | undefined;
let connection: RedisConnection | undefined;

beforeAll(async () => {
	const binary = Bun.which(process.env.REDIS_SERVER_BINARY ?? "redis-server");
	if (!binary) {
		throw new Error(
			"Redis regression tests require redis-server on PATH or REDIS_SERVER_BINARY. See README.md.",
		);
	}
	directory = await mkdtemp(join(tmpdir(), "hctx-"));
	const socket = join(directory, "redis.sock");
	server = Bun.spawn(
		[
			binary,
			"--port",
			"0",
			"--unixsocket",
			socket,
			"--unixsocketperm",
			"700",
			"--save",
			"",
			"--appendonly",
			"no",
		],
		{ cwd: directory, stdout: "ignore", stderr: "pipe" },
	);
	const deadline = Date.now() + 5000;
	while (!existsSync(socket)) {
		if (server.exitCode !== null || Date.now() >= deadline) {
			throw new Error("Isolated Redis did not create its test socket");
		}
		await Bun.sleep(10);
	}
	connection = new RedisConnection(socket, {
		lazyConnect: true,
		retryStrategy: () => null,
	});
	await connection.connect();
}, 10_000);

afterAll(async () => {
	connection?.disconnect();
	if (server) {
		server.kill();
		await server.exited;
	}
	if (directory) await rm(directory, { recursive: true, force: true });
});

function fixture() {
	if (!connection) throw new Error("Test Redis has not started");
	const redis = connection;
	// Use the real Upstash SDK's encoding/decoding around real Redis EVAL.
	const requester: Requester = {
		async request<T>(request: Parameters<Requester["request"]>[0]) {
			const [command, ...args] = request.body as unknown[];
			return {
				result: (await redis.call(String(command), ...args.map(String))) as T,
			};
		},
	};
	const prefix = `test:${crypto.randomUUID()}`;
	const port = createRedisLiveContext({ redis: new Redis(requester), prefix });
	const scope = createTenantScope({ id: "workspace" });
	const key = `${prefix}:live-context:user`;
	const input: PublishContextInput = {
		workspaceId: "workspace",
		expectedUserId: "user",
		sessionId: crypto.randomUUID(),
		sequence: 1,
		reportedAt: Date.now(),
		contextAgeMs: 2000,
		visible: true,
		focused: true,
		view: {
			pageId: crypto.randomUUID(),
			canvas: {
				canvasId: crypto.randomUUID(),
				canvasPageId: "page:one",
				selectedShapeIds: [],
				selectionCount: 0,
			},
		},
	};
	return {
		port,
		redis,
		scope,
		key,
		input,
		publish: (patch: Partial<PublishContextInput> = {}) =>
			port.publish(scope, "user", {
				...input,
				reportedAt: Date.now(),
				...patch,
			}),
		list: () => port.list(scope, "user"),
		async expireView() {
			const entry = JSON.parse((await redis.hget(key, input.sessionId))!);
			// Move only the visible expiry across the boundary, without waiting two
			// minutes or replacing the production Lua/Redis clock with a mock.
			entry.expiresAt = Date.now() - 1;
			await redis.hset(key, input.sessionId, JSON.stringify(entry));
		},
	};
}

test.each([false, true])(
	"expired context retains ordering after a withdrawal=%s",
	async (withdraw) => {
		const f = fixture();
		expect(await f.publish()).toBe(true);
		expect((await f.list())[0].view).toEqual(f.input.view);
		expect(
			await f.publish({ sequence: 3, view: withdraw ? null : f.input.view }),
		).toBe(true);
		const ttl = await f.redis.pttl(f.key);
		expect(ttl).toBeGreaterThan(LIVE_CONTEXT_TTL_MS);
		expect(ttl).toBeLessThanOrEqual(LIVE_CONTEXT_SEQUENCE_TTL_MS);
		await f.expireView();
		// The lower sequence is still inside the report-age window. Age checks
		// alone cannot prevent it undoing the newer navigation/withdrawal.
		expect(await f.publish({ sequence: 2 })).toBe(false);
		expect(await f.list()).toEqual([]);
		const tombstone = JSON.parse(
			(await f.redis.hget(f.key, f.input.sessionId))!,
		);
		expect(Number(tombstone.sequence)).toBe(3);
		expect(tombstone.payload).toBeUndefined();
		// Reads must not remove sequence state, and rejected requests must not
		// refresh its TTL or resurrect the selection.
		expect(await f.publish({ sequence: 3 })).toBe(false);
		expect(await f.redis.pttl(f.key)).toBeLessThanOrEqual(ttl);
		expect(await f.publish({ sequence: 4 })).toBe(true);
		expect((await f.list())[0]).toMatchObject({
			sequence: 4,
			view: f.input.view,
		});
	},
);

test("rejects reports after Redis has expired the entire ordering key", async () => {
	const f = fixture();
	expect(await f.publish()).toBe(true);
	expect(await f.publish({ sequence: 2, view: null })).toBe(true);
	await f.redis.pexpire(f.key, 1);
	await Bun.sleep(10);
	expect(await f.redis.exists(f.key)).toBe(0);
	const reportedAt = Date.now() - LIVE_CONTEXT_REPORT_MAX_AGE_MS;
	expect(await f.publish({ sequence: 1, reportedAt })).toBe(false);
	expect(await f.publish({ sequence: 99, reportedAt })).toBe(false);
	expect(await f.list()).toEqual([]);
	expect(await f.redis.exists(f.key)).toBe(0);
	expect(await f.publish({ sequence: 3 })).toBe(true);
	expect((await f.list())[0].sequence).toBe(3);
});

test("rejects stale reports after per-session tombstone pruning in a still-live hash", async () => {
	const f = fixture();
	expect(await f.publish({ sequence: 2, view: null })).toBe(true);
	const otherSession = crypto.randomUUID();
	expect(await f.publish({ sessionId: otherSession })).toBe(true);
	const entry = JSON.parse((await f.redis.hget(f.key, f.input.sessionId))!);
	entry.retainUntil = Date.now() - 1;
	await f.redis.hset(f.key, f.input.sessionId, JSON.stringify(entry));
	expect((await f.list()).map((value) => value.sessionId)).toEqual([
		otherSession,
	]);
	expect(await f.redis.hexists(f.key, f.input.sessionId)).toBe(0);
	expect(
		await f.publish({
			reportedAt: Date.now() - LIVE_CONTEXT_REPORT_MAX_AGE_MS,
		}),
	).toBe(false);
	expect(await f.redis.hlen(f.key)).toBe(1);
});

test("bounds report clock skew and uses Redis receipt time for freshness", async () => {
	const f = fixture();
	expect(
		await f.publish({
			reportedAt: Date.now() + LIVE_CONTEXT_CLOCK_SKEW_MS + 5000,
		}),
	).toBe(false);
	expect(await f.redis.exists(f.key)).toBe(0);
	const before = Date.now();
	expect(
		await f.publish({ reportedAt: before + LIVE_CONTEXT_CLOCK_SKEW_MS - 1000 }),
	).toBe(true);
	const [context] = await f.list();
	expect(context.lastSeenAt).toBeGreaterThanOrEqual(before);
	expect(context.lastSeenAt).toBeLessThanOrEqual(Date.now());
	expect(context.expiresAt - context.lastSeenAt).toBe(LIVE_CONTEXT_TTL_MS);
	expect(context.lastSeenAt - context.capturedAt).toBe(f.input.contextAgeMs);
	expect(context).not.toHaveProperty("reportedAt");
	expect(context).not.toHaveProperty("retainUntil");
});

test("bounds retained sessions and preserves ordering across workspace changes", async () => {
	const f = fixture();
	expect(await f.publish()).toBe(true);
	const otherScope = createTenantScope({ id: "other" });
	expect(
		await f.port.publish(otherScope, "user", { ...f.input, sequence: 2 }),
	).toBe(true);
	expect(await f.publish()).toBe(false);
	expect(await f.list()).toEqual([]);
	expect(await f.port.list(otherScope, "user")).toHaveLength(1);
	for (let index = 1; index < LIVE_CONTEXT_MAX_SESSIONS; index++) {
		expect(
			await f.publish({ sessionId: crypto.randomUUID(), view: null }),
		).toBe(true);
	}
	await f.expireView();
	expect(await f.publish({ sessionId: crypto.randomUUID() })).toBe(false);
	expect(await f.redis.hlen(f.key)).toBe(LIVE_CONTEXT_MAX_SESSIONS);
	// A retained session can resume even when all slots are occupied.
	expect(await f.publish({ sequence: 3 })).toBe(true);
});

test("preserves adjacent sequence numbers across the full supported integer range", async () => {
	const f = fixture();
	for (const sequence of [
		Number.MAX_SAFE_INTEGER - 2,
		Number.MAX_SAFE_INTEGER - 1,
		Number.MAX_SAFE_INTEGER,
	]) {
		expect(await f.publish({ sequence })).toBe(true);
		expect(await f.publish({ sequence })).toBe(false);
	}
	await f.expireView();
	expect(await f.publish({ sequence: Number.MAX_SAFE_INTEGER - 1 })).toBe(
		false,
	);
});

test("preserves ordering state from an older preview deployment", async () => {
	const f = fixture();
	const now = Date.now();
	const sequence = Number.MAX_SAFE_INTEGER - 1;
	const {
		expectedUserId: _,
		reportedAt: _reportedAt,
		contextAgeMs,
		...value
	} = f.input;
	await f.redis.hset(
		f.key,
		f.input.sessionId,
		JSON.stringify({
			...value,
			sequence,
			capturedAt: now - contextAgeMs,
			lastSeenAt: now,
			expiresAt: now + LIVE_CONTEXT_TTL_MS,
		}),
	);
	expect((await f.list())[0].view).toEqual(f.input.view);
	await f.expireView();
	expect(await f.publish({ sequence: sequence - 1 })).toBe(false);
	expect(await f.list()).toEqual([]);
	expect(await f.publish({ sequence: sequence + 1 })).toBe(true);
});

test("round-trips text through Redis and accepts older tabs without retaining stale text", async () => {
	const f = fixture();
	const view = {
		...f.input.view!,
		canvas: { ...f.input.view!.canvas!, textEditing: textEditingFixture },
	};
	expect(await f.publish({ view })).toBe(true);
	expect((await f.list())[0].view).toEqual(view);
	// A newer report replaces the full context, even from an older tab that
	// does not know about textEditing. Delayed selections cannot undo it.
	expect(await f.publish({ sequence: 3 })).toBe(true);
	expect(await f.publish({ sequence: 2, view })).toBe(false);
	expect((await f.list())[0].view?.canvas).not.toHaveProperty("textEditing");
	expect((await f.list())[0].view).toEqual(f.input.view);
	expect(
		await f.publish({
			sequence: 4,
			view: {
				...view,
				canvas: { ...view.canvas, textEditing: null },
			},
		}),
	).toBe(true);
	expect((await f.list())[0].view?.canvas?.textEditing).toBeNull();
});

test("page ranges round-trip through Redis, and clearing or older-client reports replace them completely", async () => {
	const f = fixture();
	const view = {
		pageId: crypto.randomUUID(),
		canvas: null,
		pageSelection: pageSelectionFixture,
	};
	expect(await f.publish({ view })).toBe(true);
	expect((await f.list())[0].view).toEqual(view);
	expect(
		await f.publish({ sequence: 3, view: { ...view, pageSelection: null } }),
	).toBe(true);
	expect(await f.publish({ sequence: 2, view })).toBe(false);
	expect((await f.list())[0].view?.pageSelection).toBeNull();
	expect(await f.publish({ sequence: 4, view })).toBe(true);
	const oldView = { pageId: view.pageId, canvas: null };
	expect(await f.publish({ sequence: 5, view: oldView })).toBe(true);
	expect((await f.list())[0].view).toEqual(oldView);
});
