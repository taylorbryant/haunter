import { createCanvasSyncServer } from "@/infra/canvases/sync-server";
import { createCanvasPreviewRenderer } from "@/infra/canvases/preview-renderer";
import { checkDocumentAccess } from "@/infra/documents/access";
import { createDocumentServer } from "@/infra/documents/hocuspocus";
import {
	listenDocumentServer,
	stopDocumentServer,
} from "@/infra/documents/bun-transport";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { env } from "@/lib/env";
import { getServer } from "@/server";
import { drizzle } from "drizzle-orm/libsql";
import { databaseClient } from "@/infra/db/client";
import * as schema from "@/infra/db/schema";
import { createWorkerLease } from "@/infra/documents/worker-lease";
import { createCanvasCommandHandler } from "@/infra/canvases/command-bridge";
import { appError } from "@/features/shared/errors";
import { and, eq, isNull, or } from "drizzle-orm";

if (!env.NEXT_PUBLIC_COLLABORATION_URL)
	throw new Error(
		"Set NEXT_PUBLIC_COLLABORATION_URL before starting collaboration.",
	);
const app = await getServer();
const preflight = await (
	await app.createServiceContext()
).ports.documentMaintenance.migrate({ dryRun: true });
if (
	preflight.converted > 0 ||
	preflight.projectionsUpdated > 0 ||
	preflight.canvasesConverted > 0
)
	throw new Error("Run documents.migrate before starting collaboration.");
const lease = createWorkerLease(drizzle(databaseClient, { schema }));
await lease.acquire();
const failedDocuments = new Set<string>();
let heartbeatHealthy = true;
let renewing = false;
const heartbeat = setInterval(async () => {
	if (renewing) return;
	renewing = true;
	try {
		await lease.renew();
		heartbeatHealthy = true;
	} catch {
		heartbeatHealthy = false;
		console.error("Collaboration worker could not renew its database lease");
		if (!lease.valid()) {
			server.closeConnections();
			canvasServer.closeConnections();
			// Expired owners are fenced in the save transaction. Clients retain
			// unacknowledged updates for the replacement worker.
			process.exit(1);
		}
	} finally {
		renewing = false;
	}
}, 5000);
const tokens = createDocumentSessionTokens(env.BETTER_AUTH_SECRET);
const origins = {
	origin: new URL(env.APP_URL).origin,
	additionalOrigins: env.COLLABORATION_ALLOWED_ORIGINS,
};
const sharedOptions = {
	workerOwnerId: lease.ownerId,
	canWrite: () => lease.valid(),
	onStorageHealth: (name: string, healthy: boolean) => {
		if (healthy) failedDocuments.delete(name);
		else failedDocuments.add(name);
	},
	verify: tokens.verify,
	async authorize(grant: import("@/features/documents/ports").DocumentGrant) {
		const role = await checkDocumentAccess(grant);
		const ctx = await app.createServiceContext({
			tenantId: grant.workspaceId,
			asUser: { id: grant.userId, role },
		});
		return { ctx, role };
	},
};
const server = createDocumentServer({
	...sharedOptions,
	...origins,
});
const canvasPreviewRenderer = createCanvasPreviewRenderer({
	licenseKey: process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY,
});
const canvasServer = createCanvasSyncServer({
	...sharedOptions,
	previewRenderer: canvasPreviewRenderer,
});
let stopping = false;
const transport = listenDocumentServer(server, {
	canvases: canvasServer,
	canvasCommands: createCanvasCommandHandler({
		secret: env.BETTER_AUTH_SECRET,
		canvases: canvasServer,
		async authorize({ userId, workspaceId }) {
			const db = drizzle(databaseClient, { schema });
			const [member] = await db
				.select({ role: schema.member.role })
				.from(schema.member)
				.innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
				.where(
					and(
						eq(schema.member.userId, userId),
						eq(schema.member.organizationId, workspaceId),
						or(isNull(schema.user.banned), eq(schema.user.banned, false)),
						eq(schema.user.accessStatus, "approved"),
					),
				);
			if (!member) throw appError("Forbidden");
			return app.createServiceContext({
				tenantId: workspaceId,
				asUser: { id: userId, role: member.role },
			});
		},
	}),
	port: Number(process.env.COLLABORATION_PORT ?? 1234),
	hostname: process.env.COLLABORATION_HOST ?? "127.0.0.1",
	...origins,
	canAcceptConnections: () => !stopping && lease.valid(),
	isReady: () => heartbeatHealthy && failedDocuments.size === 0,
});
console.info(
	`Haunter collaboration listening on ${transport.hostname}:${transport.port}`,
);
async function stop() {
	if (stopping) return;
	stopping = true;
	try {
		await canvasServer.flush();
		await stopDocumentServer(server);
		await canvasServer.stop();
		await canvasPreviewRenderer.stop();
		await transport.stop(true);
		clearInterval(heartbeat);
		await lease.release();
		await app.stop();
		process.exit(0);
	} catch (error) {
		// A failed store must not turn a graceful shutdown into lost in-memory edits.
		stopping = false;
		console.error(
			"Collaboration shutdown failed; retry after storage recovers.",
			error,
		);
	}
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
