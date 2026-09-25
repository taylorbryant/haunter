import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import type { LiveContextPort } from "@/features/live-context/ports";
import {
	LIVE_CONTEXT_MAX_SESSIONS,
	LIVE_CONTEXT_TTL_MS,
	StoredContextSchema,
} from "@/features/live-context/schemas";

type ContextRedis = {
	eval<TArgs extends unknown[], TData = unknown>(
		script: string,
		keys: string[],
		args: TArgs,
	): Promise<TData>;
};

// One bounded hash per user, with expiring entries and an expiring key.
// Sequence checks and tombstones prevent delayed requests undoing navigation.
const CONTEXT_SCRIPT = `
local entries = redis.call('HGETALL', KEYS[1])
local now = tonumber(ARGV[1])
local count = 0
local result = {}
for i = 1, #entries, 2 do
  local entry = cjson.decode(entries[i + 1])
  if entry.expiresAt <= now then
    redis.call('HDEL', KEYS[1], entries[i])
  else
    count = count + 1
    table.insert(result, entries[i + 1])
  end
end
if ARGV[2] == 'list' then return result end
local next = cjson.decode(ARGV[3])
local previous = redis.call('HGET', KEYS[1], next.sessionId)
if previous and cjson.decode(previous).sequence >= next.sequence then return 0 end
if not previous and count >= tonumber(ARGV[4]) then return 0 end
redis.call('HSET', KEYS[1], next.sessionId, ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

export function createRedisLiveContext({
	redis,
	prefix,
	now = Date.now,
}: {
	redis: ContextRedis | null;
	prefix: string;
	now?: () => number;
}): LiveContextPort {
	const key = (userId: string) =>
		`${prefix}:live-context:${encodeURIComponent(userId)}`;
	return {
		isConfigured: () => redis !== null,
		async publish(scope, userId, input) {
			if (!redis) return false;
			const { expectedUserId: _, contextAgeMs, ...value } = input;
			const time = now();
			const entry = {
				...value,
				workspaceId: tenantScopeId(scope),
				capturedAt: time - Math.min(contextAgeMs, 7 * 86_400_000),
				lastSeenAt: time,
				expiresAt: time + LIVE_CONTEXT_TTL_MS,
			};
			return (
				(await redis.eval(
					CONTEXT_SCRIPT,
					[key(userId)],
					[
						time,
						"publish",
						JSON.stringify(entry),
						LIVE_CONTEXT_MAX_SESSIONS,
						LIVE_CONTEXT_TTL_MS,
					],
				)) === 1
			);
		},
		async list(scope, userId) {
			if (!redis) return [];
			const values = await redis.eval<[number, string], unknown[]>(
				CONTEXT_SCRIPT,
				[key(userId)],
				[now(), "list"],
			);
			return values.flatMap((value) => {
				// Upstash recursively deserializes JSON strings in EVAL arrays by
				// default. Also accept raw strings for other Redis transports.
				let decoded = value;
				if (typeof value === "string") {
					try {
						decoded = JSON.parse(value);
					} catch {
						return [];
					}
				}
				const parsed = StoredContextSchema.safeParse(decoded);
				return parsed.success &&
					parsed.data.workspaceId === tenantScopeId(scope)
					? [parsed.data]
					: [];
			});
		},
	};
}
