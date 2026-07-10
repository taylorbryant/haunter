import "@beignet/core/server-only";
import {
	createErrorReportingHooks,
	createIdempotencyHooks,
	createRateLimitHooks,
	createSecurityHeadersHooks,
	type ServerHook,
} from "@beignet/core/server";
import { createNextServer, createNextServerLoader } from "@beignet/next";
import type { AppContext } from "@/app-context";
import { appPorts } from "@/infra/app-ports";
import { env } from "@/lib/env";
import { appContext } from "./context";
import { providers } from "./providers";
import { routes } from "./routes";

/**
 * Dev-only per-stage request timings, one compact line per request. The
 * same numbers feed the devtools waterfall; this makes them greppable so
 * latency work (e.g. how much of a request is context creation) starts
 * from measurements instead of endpoint-total inference.
 */
const devStageTimingsHook: ServerHook<AppContext> = {
	afterSend: ({ contract, durationMs, stages }) => {
		console.info(
			`[stages] ${contract.method.toUpperCase()} ${contract.name} ` +
				`${Math.round(durationMs)}ms — context=${Math.round(stages.contextMs)} ` +
				`parse=${Math.round(stages.parseMs)} hooks=${Math.round(stages.beforeHandleMs)} ` +
				`handler=${Math.round(stages.handlerMs)} send=${Math.round(stages.sendMs)}`,
		);
	},
};

/**
 * Lazily construct the server the first time a route handles a request.
 * Next.js imports route modules during production builds; deferring boot
 * behind this loader keeps that import side-effect-free. The loader
 * memoizes, so every route shares one server instance at runtime.
 */
export const getServer = createNextServerLoader(() =>
	createNextServer({
		ports: appPorts,
		providers,
		providerConfig: {
			"drizzle-sqlite": {
				DB_URL: env.SQLITE_DB_URL,
				DB_AUTH_TOKEN: env.SQLITE_DB_AUTH_TOKEN,
			},
		},
		hooks: [
			createSecurityHeadersHooks<AppContext>(),
			createErrorReportingHooks<AppContext>(),
			createIdempotencyHooks<AppContext>(),
			// Enforces contract.meta.rateLimit. The Vercel edge normalizes
			// x-forwarded-for (client IP first), so the first entry is trusted
			// here; locally the header is absent and ip scopes share one bucket.
			createRateLimitHooks<AppContext>({
				ipSource: "x-forwarded-for-first",
			}),
			...(env.NODE_ENV !== "production" ? [devStageTimingsHook] : []),
		],
		context: appContext,
		routes,
		mapUnhandledError: ({ err, ctx }) => {
			ctx?.ports.logger.error("Unhandled API error", {
				error: err,
				requestId: ctx?.requestId,
				environment: env.NODE_ENV,
			});

			return {
				status: 500,
				body: {
					code: "INTERNAL_SERVER_ERROR",
					message: "Internal server error",
					requestId: ctx?.requestId,
				},
			};
		},
	}),
);
