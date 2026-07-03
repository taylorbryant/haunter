import "@beignet/core/server-only";
import { createNextServer, createNextServerLoader } from "@beignet/next";
import {
	createErrorReportingHooks,
	createIdempotencyHooks,
} from "@beignet/core/server";
import type { AppContext } from "@/app-context";
import { appPorts } from "@/infra/app-ports";
import { env } from "@/lib/env";
import { appContext } from "./context";
import { providers } from "./providers";
import { routes } from "./routes";

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
			createErrorReportingHooks<AppContext>(),
			createIdempotencyHooks<AppContext>(),
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
