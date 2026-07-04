import "@beignet/core/server-only";
import { createMemoryRateLimiter } from "@beignet/core/ports";
import { createProvider } from "@beignet/core/providers";

/**
 * In-process rate limiter for dev and tests without Upstash credentials.
 * Not durable or distributed — deployed environments use
 * @beignet/provider-rate-limit-upstash instead.
 */
export const memoryRateLimitProvider = createProvider()({
	name: "memory-rate-limit",
	async setup() {
		return {
			ports: { rateLimit: createMemoryRateLimiter() },
		};
	},
});
