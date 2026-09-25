import { expect, test } from "bun:test";
import { Redis, type Requester } from "@upstash/redis";
import { createTenantScope } from "@beignet/core/ports";
import { createRedisLiveContext } from "@/infra/live-context/redis-live-context";
import {
	LIVE_CONTEXT_MAX_SESSIONS,
	LIVE_CONTEXT_TTL_MS,
	type PublishContextInput,
} from "../schemas";

const input: PublishContextInput = {
	workspaceId: "workspace",
	expectedUserId: "user",
	sessionId: crypto.randomUUID(),
	sequence: 1,
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
		now: () => 50_000,
	});
	const scope = createTenantScope({ id: "workspace" });
	expect(await port.publish(scope, "user", input)).toBe(true);
	const args = requests[0];
	expect(args[0]).toBe("eval");
	expect(args[2]).toBe(1);
	expect(args[3]).toBe("test:live-context:user");
	expect(args.at(-2)).toBe(LIVE_CONTEXT_MAX_SESSIONS);
	expect(args.at(-1)).toBe(LIVE_CONTEXT_TTL_MS);
	const stored = JSON.parse(args[6] as string);
	expect(stored).toMatchObject({
		capturedAt: 48_000,
		lastSeenAt: 50_000,
		expiresAt: 170_000,
		sequence: 1,
	});
	expect(stored.expectedUserId).toBeUndefined();
	result = [
		JSON.stringify(stored),
		JSON.stringify({ ...stored, workspaceId: "other" }),
		"bad-json",
	];
	expect(await port.list(scope, "user")).toEqual([stored]);
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
