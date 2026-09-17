import "@beignet/core/server-only";
import { randomUUID } from "node:crypto";
import type { WorkspaceEventStreamLeasePort } from "@/features/collab/ports";

type LeaseRedis = {
	eval<TArgs extends unknown[], TData = unknown>(
		script: string,
		keys: string[],
		args: TArgs,
	): Promise<TData>;
	zrem<TData>(key: string, ...members: TData[]): Promise<number>;
};
const ACQUIRE_STREAM_LEASE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local expires_at = tonumber(ARGV[2])
local token = ARGV[3]
local max_connections = tonumber(ARGV[4])
local key_ttl = tonumber(ARGV[5])

redis.call("ZREMRANGEBYSCORE", key, "-inf", now)
redis.call("PEXPIRE", key, key_ttl)
if redis.call("ZCARD", key) >= max_connections then
  return 0
end

redis.call("ZADD", key, expires_at, token)
redis.call("PEXPIRE", key, key_ttl)
return 1
`;

export function workspaceEventStreamLeaseKey(prefix: string, userId: string) {
	return `${prefix}:streams:${userId}`;
}
export function createWorkspaceEventStreamLeases({
	redis,
	prefix,
}: {
	redis: LeaseRedis | null;
	prefix: string;
}): WorkspaceEventStreamLeasePort {
	return {
		isConfigured() {
			return redis !== null;
		},
		async acquire({ userId, maxConnections, ttlMs }) {
			if (!redis) return null;
			const key = workspaceEventStreamLeaseKey(prefix, userId);
			const token = randomUUID();
			const now = Date.now();
			const acquired = await redis.eval<
				[number, number, string, number, number],
				number
			>(
				ACQUIRE_STREAM_LEASE_SCRIPT,
				[key],
				[now, now + ttlMs, token, maxConnections, ttlMs + 60_000],
			);
			if (acquired !== 1) return null;

			let released = false;
			return {
				async release() {
					if (released) return;
					released = true;
					await redis.zrem(key, token);
				},
			};
		},
	};
}
