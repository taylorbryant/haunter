import { enqueueJob } from "@beignet/core/outbox";
import { WebhookHandler } from "@liveblocks/node";
import { MaterializeDocumentJob } from "@/features/documents/jobs";
import { parseDocumentId } from "@/features/documents/model";
import { env } from "@/lib/env";
import { getServer } from "@/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
	if (!env.LIVEBLOCKS_WEBHOOK_SECRET) {
		return Response.json(
			{ message: "Liveblocks webhooks are not configured." },
			{ status: 503 },
		);
	}
	const rawBody = await request.clone().text();
	let event: ReturnType<WebhookHandler["verifyRequest"]>;
	try {
		event = new WebhookHandler(env.LIVEBLOCKS_WEBHOOK_SECRET).verifyRequest({
			headers: request.headers,
			rawBody,
		});
	} catch {
		return Response.json(
			{ message: "Invalid webhook signature." },
			{ status: 400 },
		);
	}
	if (event.type !== "ydocUpdated" || !parseDocumentId(event.data.roomId)) {
		return new Response(null, { status: 204 });
	}

	const server = await getServer();
	const handler = server
		.rawRoute({
			name: "liveblocks-ydoc-updated",
			method: "POST",
			path: "/api/webhooks/liveblocks",
		})
		.handle(async ({ ctx }) => {
			const document = await ctx.ports.documents.findGlobalByDocumentId(
				event.data.roomId,
			);
			if (document?.state !== "ready") {
				return new Response(null, { status: 202 });
			}
			await ctx.ports.uow.transaction(async (tx) => {
				await enqueueJob(
					tx.outbox,
					MaterializeDocumentJob,
					{
						documentId: document.documentId,
						workspaceId: document.workspaceId,
					},
					{
						// The authenticated browser also queues exact task-assignment
						// provenance. Give that job a short head start; this actorless
						// webhook remains the durable projection fallback.
						availableAt: new Date(Date.now() + 5_000),
						id: request.headers.get("webhook-id")
							? `liveblocks:${request.headers.get("webhook-id")}`
							: undefined,
					},
				);
			});
			return new Response(null, { status: 202 });
		});

	return handler(request);
}
