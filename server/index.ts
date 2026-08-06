import "@beignet/core/server-only";
import {
	createCsrfHooks,
	createErrorReportingHooks,
	createIdempotencyHooks,
	createRateLimitHooks,
	createSecurityHeadersHooks,
	type ServerHook,
} from "@beignet/core/server";
import { createNextServer, createNextServerLoader } from "@beignet/next";
import type { AppContext } from "@/app-context";
import { appPorts } from "@/infra/app-ports";
import { closeDatabaseClient } from "@/infra/db/client";
import { env } from "@/lib/env";
import { appContext } from "./context";
import { routes } from "./routes";

const stageTimingsHook: ServerHook<AppContext> = {
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
export const getServer = createNextServerLoader(async () => {
	const { providers } = await import("./providers");
	const server = await createNextServer({
		ports: appPorts,
		providers,
		hooks: [
			createSecurityHeadersHooks<AppContext>(),
			createCsrfHooks<AppContext>(),
			createErrorReportingHooks<AppContext>(),
			createIdempotencyHooks<AppContext>(),
			// Enforces contract.meta.rateLimit. The Vercel edge normalizes
			// x-forwarded-for (client IP first), so the first entry is trusted
			// here; locally the header is absent and ip scopes share one bucket.
			createRateLimitHooks<AppContext>({
				ipSource: "x-forwarded-for-first",
			}),
			...(env.NODE_ENV !== "production" ||
			process.env.HAUNTER_PERFORMANCE_LOGGING === "1"
				? [stageTimingsHook]
				: []),
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
	let stopPromise: Promise<void> | undefined;

	return {
		...server,
		stop() {
			stopPromise ??= stopServerAndDatabase(server);
			return stopPromise;
		},
	};
});

async function stopServerAndDatabase(server: {
	stop(): Promise<void>;
}): Promise<void> {
	const errors: unknown[] = [];
	try {
		await server.stop();
	} catch (error) {
		errors.push(error);
	}

	try {
		await closeDatabaseClient();
	} catch (error) {
		errors.push(error);
	}

	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) {
		throw new AggregateError(errors, "Server and database shutdown failed");
	}
}
