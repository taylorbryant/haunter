import "@beignet/core/server-only";
import { randomUUID } from "node:crypto";
import { createProvider } from "@beignet/core/providers";
import { Redis } from "@upstash/redis";
import {
	isWorkspaceEvent,
	type WorkspaceEvent,
	type WorkspaceEventPublisherPort,
	type WorkspaceEventStreamLeasePort,
	type WorkspaceEventSubscriberPort,
} from "@/features/collab/workspace-events";
import { env } from "@/lib/env";

type MessageHandler = (message: { channel: string; message: unknown }) => void;

type RedisSubscriber = {
	on(event: "subscribe", handler: () => void): void;
	on(event: "message", handler: MessageHandler): void;
	on(event: "error", handler: (error: unknown) => void): void;
	removeAllListeners(): void;
	unsubscribe(): Promise<void>;
};

type WorkspaceEventRedis = {
	publish(channel: string, event: WorkspaceEvent): Promise<number>;
	subscribe(channel: string): RedisSubscriber;
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

export function workspaceEventChannel(
	prefix: string,
	workspaceId: string,
): string {
	return `${prefix}:${workspaceId}`;
}

export function workspaceEventStreamLeaseKey(
	prefix: string,
	userId: string,
): string {
	return `${prefix}:streams:${userId}`;
}

export function createUpstashWorkspaceEventPorts(input: {
	redis: WorkspaceEventRedis | null;
	prefix: string;
}): {
	workspaceEvents: WorkspaceEventPublisherPort;
	workspaceEventStreamLeases: WorkspaceEventStreamLeasePort;
	workspaceEventSubscriptions: WorkspaceEventSubscriberPort;
} {
	const { redis, prefix } = input;
	return {
		workspaceEvents: {
			async publish(event) {
				if (!redis) return;
				await redis.publish(
					workspaceEventChannel(prefix, event.workspaceId),
					event,
				);
			},
		},
		workspaceEventStreamLeases: {
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
		},
		workspaceEventSubscriptions: {
			isConfigured() {
				return redis !== null;
			},
			subscribe({ workspaceId, onReady, onEvent, onError }) {
				if (!redis) return null;
				const channel = workspaceEventChannel(prefix, workspaceId);
				const subscriber = redis.subscribe(channel);
				subscriber.on("subscribe", onReady);
				subscriber.on("message", ({ channel: source, message }) => {
					if (
						source !== channel ||
						!isWorkspaceEvent(message) ||
						message.workspaceId !== workspaceId
					) {
						return;
					}
					onEvent(message);
				});
				subscriber.on("error", onError);
				return {
					async unsubscribe() {
						subscriber.removeAllListeners();
						await subscriber.unsubscribe();
					},
				};
			},
		},
	};
}

export const upstashWorkspaceEventProvider = createProvider()({
	name: "upstash-workspace-events",
	setup() {
		const redis =
			env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
				? new Redis({
						url: env.UPSTASH_REDIS_REST_URL,
						token: env.UPSTASH_REDIS_REST_TOKEN,
					})
				: null;
		return {
			ports: createUpstashWorkspaceEventPorts({
				redis,
				prefix: env.UPSTASH_WORKSPACE_EVENT_PREFIX,
			}),
		};
	},
});
