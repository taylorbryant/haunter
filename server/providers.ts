import "@beignet/core/server-only";
import { createInlineNotificationsProvider } from "@beignet/core/notifications";
import { createObservedUnitOfWork } from "@beignet/core/ports";
import { createProvider } from "@beignet/core/providers";
import { createDevtoolsProvider } from "@beignet/devtools";
import { createNextOutboxDrainTrigger } from "@beignet/next";
import { createBetterAuthProvider } from "@beignet/provider-auth-better-auth";
import { createDrizzleSqliteProvider } from "@beignet/provider-db-drizzle/sqlite";
import { createPinoLoggerProvider } from "@beignet/provider-logger-pino";
import { createResendMailProvider } from "@beignet/provider-mail-resend";
import { createUpstashRateLimitProvider } from "@beignet/provider-rate-limit-upstash";
import { createLocalStorageProvider } from "@beignet/provider-storage-local";
import { createVercelBlobStorageProvider } from "@beignet/provider-storage-vercel-blob";
import { after } from "next/server";
import type { AppContext } from "@/app-context";
import { liveblocksWorkspaceEventProvider } from "@/infra/collab/liveblocks-workspace-event-provider";
import { databaseClient } from "@/infra/db/client";
import { starterDatabaseProvider } from "@/infra/db/provider";
import * as schema from "@/infra/db/schema";
import { liveblocksDocumentStoreProvider } from "@/infra/documents/liveblocks-document-store-provider";
import { webPushProvider } from "@/infra/notifications/web-push-provider";
import { memoryRateLimitProvider } from "@/infra/rate-limit/memory-rate-limit-provider";
import { nextAfterResponseProvider } from "@/infra/runtime/next-after-response-provider";
import { auth } from "@/lib/better-auth";
import { env } from "@/lib/env";
import type { AppPorts } from "@/ports";
import type { AuthSessionMetadata, AuthUser } from "@/ports/auth";
import type { AppServiceContextInput } from "@/server/context";
import { notificationPreferences } from "@/server/notification-preferences";

const drizzleSqliteProvider = createDrizzleSqliteProvider({
	schema,
	client: databaseClient,
});

const outboxDrainProvider = createProvider<
	Pick<AppPorts, "uow">,
	AppContext,
	AppServiceContextInput
>()({
	name: "outbox-drain-trigger",
	setup({ ports, createServiceContext }): { ports: Pick<AppPorts, "uow"> } {
		const triggerOutboxDrain = createNextOutboxDrainTrigger({
			defer: after,
			createContext: () => createServiceContext(undefined),
			registry: async () => (await import("@/server/outbox")).outboxRegistry,
			batchSize: 100,
		});
		return {
			ports: {
				uow: createObservedUnitOfWork({
					unitOfWork: ports.uow,
					afterCommit: triggerOutboxDrain,
				}),
			},
		};
	},
});

export const providers = [
	createDevtoolsProvider(),
	createBetterAuthProvider<AuthUser, AuthSessionMetadata>({ auth }),
	createPinoLoggerProvider(),
	nextAfterResponseProvider,
	drizzleSqliteProvider,
	starterDatabaseProvider,
	outboxDrainProvider,
	liveblocksWorkspaceEventProvider,
	liveblocksDocumentStoreProvider,
	// Failed channel results must fail the schedule invocation so production
	// monitoring sees delivery failures; the inbox still owns retry timing.
	createInlineNotificationsProvider({
		failureMode: "throw",
		preferences: notificationPreferences,
	}),
	webPushProvider,
	// Vercel Blob in deployed environments (local disk doesn't survive
	// serverless); the local provider keeps dev working with zero setup.
	env.BLOB_READ_WRITE_TOKEN
		? createVercelBlobStorageProvider()
		: createLocalStorageProvider(),
	createResendMailProvider(),
	// Durable, shared rate limiting in deployed environments; the in-process
	// limiter keeps dev and tests working without Upstash credentials.
	env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
		? createUpstashRateLimitProvider()
		: memoryRateLimitProvider,
] as const;
