import { expect, test } from "bun:test";
import { Redis, type Requester } from "@upstash/redis";
import { createTenantScope } from "@beignet/core/ports";
import { createRedisLiveContext } from "@/infra/live-context/redis-live-context";
import {
	LIVE_CONTEXT_MAX_SESSIONS,
	LIVE_CONTEXT_TTL_MS,
	LIVE_CONTEXT_REPORT_MAX_AGE_MS,
	LIVE_CONTEXT_CLOCK_SKEW_MS,
	LIVE_CONTEXT_SEQUENCE_TTL_MS,
	type PublishContextInput,
} from "../schemas";

const input: PublishContextInput = {
	workspaceId: "workspace",
	expectedUserId: "user",
	sessionId: crypto.randomUUID(),
	sequence: 1,
	reportedAt: 50_000,
	contextAgeMs: 2000,
	visible: true,
	focused: true,
	view: { pageId: crypto.randomUUID(), canvas: null },
};
test("the actual Upstash SDK can roundtrip EVAL results with its default JSON deserialization", async () => {
	const requests: unknown[][] = [];
	let result: unknown = 1;
	const requester: Requester = {
		async request<T>(request: Parameters<Requester["request"]>[0]) {
			requests.push(request.body as unknown[]);
			return { result: result as T };
		},
	};
	const port = createRedisLiveContext({
		redis: new Redis(requester),
		prefix: "test",
	});
	const scope = createTenantScope({ id: "workspace" });
	expect(await port.publish(scope, "user", input)).toBe(true);
	const args = requests[0];
	expect(args[0]).toBe("eval");
	expect(args[2]).toBe(1);
	expect(args[3]).toBe("test:live-context:user");
	expect(args.slice(6)).toEqual([
		LIVE_CONTEXT_MAX_SESSIONS,
		LIVE_CONTEXT_TTL_MS,
		LIVE_CONTEXT_REPORT_MAX_AGE_MS,
		LIVE_CONTEXT_CLOCK_SKEW_MS,
		LIVE_CONTEXT_SEQUENCE_TTL_MS,
	]);
	const payload = JSON.parse(args[5] as string);
	expect(payload.expectedUserId).toBeUndefined();
	const timestamps = {
		capturedAt: 48_000,
		lastSeenAt: 50_000,
		expiresAt: 170_000,
	};
	result = [
		JSON.stringify({ payload: JSON.stringify(payload), ...timestamps }),
		JSON.stringify({
			payload: JSON.stringify({ ...payload, workspaceId: "other" }),
			...timestamps,
		}),
		"bad-json",
	];
	const { contextAgeMs: _, reportedAt: _reportedAt, ...stored } = payload;
	expect(await port.list(scope, "user")).toEqual([
		{ ...stored, ...timestamps },
	]);
	await port.list(scope, "another-user");
	expect(requests.at(-1)?.[3]).toBe("test:live-context:another-user");
});

test("raw Redis results are validated and unavailable configuration is explicit", async () => {
	const port = createRedisLiveContext({
		redis: {
			async eval<_TArgs extends unknown[], TData>() {
				return ["bad-json", { incomplete: true }] as TData;
			},
		},
		prefix: "test",
	});
	expect(
		await port.list(createTenantScope({ id: "workspace" }), "user"),
	).toEqual([]);
	expect(
		createRedisLiveContext({ redis: null, prefix: "test" }).isConfigured(),
	).toBe(false);
});
