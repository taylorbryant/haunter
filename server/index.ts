import "@beignet/core/server-only";
import { createNextServer } from "@beignet/next";
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

export const server = await createNextServer({
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
});
