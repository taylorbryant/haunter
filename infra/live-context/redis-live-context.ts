import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import { z } from "zod";
import type { LiveContextPort } from "@/features/live-context/ports";
import {
	LIVE_CONTEXT_MAX_SESSIONS,
	LIVE_CONTEXT_TTL_MS,
	LIVE_CONTEXT_CLOCK_SKEW_MS,
	LIVE_CONTEXT_REPORT_MAX_AGE_MS,
	LIVE_CONTEXT_SEQUENCE_TTL_MS,
	StoredContextSchema,
} from "@/features/live-context/schemas";

type ContextRedis = {
	eval<TArgs extends unknown[], TData = unknown>(
		script: string,
		keys: string[],
		args: TArgs,
	): Promise<TData>;
};

// One bounded hash per user. Expiring views and sequence tombstones have separate
// lifetimes. Validate report age inside Redis, including time spent in transit
// to Redis: once a tombstone expires, an older report must already be too old.
const CONTEXT_SCRIPT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local entries = redis.call('HGETALL', KEYS[1])
local count = 0
local result = {}
for i = 1, #entries, 2 do
  local entry = cjson.decode(entries[i + 1])
  -- Older preview deployments stored the context directly, without an envelope.
  local retainUntil = entry.retainUntil or (entry.expiresAt + ${LIVE_CONTEXT_SEQUENCE_TTL_MS - LIVE_CONTEXT_TTL_MS})
  if retainUntil <= now then
    redis.call('HDEL', KEYS[1], entries[i])
  else
    count = count + 1
    if entry.expiresAt > now then
      table.insert(result, entries[i + 1])
    elseif entry.payload or not entry.retainUntil then
      redis.call('HSET', KEYS[1], entries[i], cjson.encode({
        sequence = string.format('%.0f', tonumber(entry.sequence)),
        expiresAt = entry.expiresAt,
        retainUntil = retainUntil
      }))
    end
  end
end
if ARGV[1] == 'list' then return result end
local next = cjson.decode(ARGV[2])
if next.reportedAt <= now - tonumber(ARGV[5]) or
   next.reportedAt > now + tonumber(ARGV[6]) then return 0 end
local previous = redis.call('HGET', KEYS[1], next.sessionId)
if previous and tonumber(cjson.decode(previous).sequence) >= next.sequence then return 0 end
if not previous and count >= tonumber(ARGV[3]) then return 0 end
local entry = {
  sequence = string.format('%.0f', next.sequence),
  capturedAt = now - math.min(next.contextAgeMs, 7 * 86400000),
  lastSeenAt = now,
  expiresAt = now + tonumber(ARGV[4]),
  retainUntil = now + tonumber(ARGV[7]),
  payload = ARGV[2]
}
redis.call('HSET', KEYS[1], next.sessionId, cjson.encode(entry))
redis.call('PEXPIRE', KEYS[1], ARGV[7])
return 1
`;

// Preserve the original JSON payload: Lua cjson would otherwise turn empty
// selectedShapeIds arrays into objects when re-encoding them.
const EnvelopeSchema = z.object({
	payload: z.string(),
	capturedAt: z.number(),
	lastSeenAt: z.number(),
	expiresAt: z.number(),
});
function decode(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

export function createRedisLiveContext({
	redis,
	prefix,
}: {
	redis: ContextRedis | null;
	prefix: string;
}): LiveContextPort {
	const key = (userId: string) =>
		`${prefix}:live-context:${encodeURIComponent(userId)}`;
	return {
		isConfigured: () => redis !== null,
		async publish(scope, userId, input) {
			if (!redis) return false;
			const { expectedUserId: _, ...value } = input;
			const payload = {
				...value,
				workspaceId: tenantScopeId(scope),
			};
			return (
				(await redis.eval(
					CONTEXT_SCRIPT,
					[key(userId)],
					[
						"publish",
						JSON.stringify(payload),
						LIVE_CONTEXT_MAX_SESSIONS,
						LIVE_CONTEXT_TTL_MS,
						LIVE_CONTEXT_REPORT_MAX_AGE_MS,
						LIVE_CONTEXT_CLOCK_SKEW_MS,
						LIVE_CONTEXT_SEQUENCE_TTL_MS,
					],
				)) === 1
			);
		},
		async list(scope, userId) {
			if (!redis) return [];
			const values = await redis.eval<[string], unknown[]>(
				CONTEXT_SCRIPT,
				[key(userId)],
				["list"],
			);
			return values.flatMap((value) => {
				// Upstash recursively deserializes JSON strings in EVAL arrays by
				// default. Also accept raw strings for other Redis transports.
				const envelope = EnvelopeSchema.safeParse(decode(value));
				if (!envelope.success) {
					// Let reports from an older preview deployment expire normally.
					const legacy = StoredContextSchema.safeParse(decode(value));
					return legacy.success &&
						legacy.data.workspaceId === tenantScopeId(scope)
						? [legacy.data]
						: [];
				}
				const { payload, ...timestamps } = envelope.data;
				const decoded = decode(payload);
				if (!decoded || typeof decoded !== "object") return [];
				const parsed = StoredContextSchema.safeParse({
					...decoded,
					...timestamps,
				});
				return parsed.success &&
					parsed.data.workspaceId === tenantScopeId(scope)
					? [parsed.data]
					: [];
			});
		},
	};
}
