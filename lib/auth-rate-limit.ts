import { Redis } from "@upstash/redis";
import type { BetterAuthOptions } from "better-auth";
import { env } from "@/lib/env";

type AuthRateLimitStorage = NonNullable<
	NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]
>;

/**
 * Better Auth's /api/auth/* endpoints sit outside Beignet's contract hooks,
 * so its built-in rate limiter (OTP send: 3/min, sign-in: 3/10s) is the only
 * throttle on them. Its default memory storage resets per serverless
 * instance, which makes it near-useless on Vercel — this storage backs it
 * with the same Upstash Redis the Beignet rateLimit port uses.
 *
 * `customStorage` is rate-limit-only: unlike `secondaryStorage`, providing
 * it does not move session storage into Redis.
 */

// INCR + first-hit EXPIRE in one script so a crash between the two can't
// leave an immortal counter, and concurrent requests can't both pass a
// stale read (Better Auth falls back to non-atomic get/set otherwise).
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('TTL', KEYS[1])}
`;

export function createAuthRateLimitStorage(): AuthRateLimitStorage | null {
	if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
		return null;
	}
	const redis = new Redis({
		url: env.UPSTASH_REDIS_REST_URL,
		token: env.UPSTASH_REDIS_REST_TOKEN,
	});
	const prefixed = (key: string) => `${env.UPSTASH_PREFIX}:auth:${key}`;

	return {
		async consume(key, rule) {
			const [count, ttl] = await redis.eval<[number], [number, number]>(
				CONSUME_SCRIPT,
				[prefixed(key)],
				[rule.window],
			);
			if (count <= rule.max) {
				return { allowed: true, retryAfter: null };
			}
			return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
		},
	};
}
