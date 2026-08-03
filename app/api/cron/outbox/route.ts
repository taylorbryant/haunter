import { createOutboxDrainRoute } from "@beignet/next";
import { env } from "@/lib/env";
import { getServer } from "@/server";
import { outboxRegistry } from "@/server/outbox";

export const runtime = "nodejs";

export const { GET, POST } = createOutboxDrainRoute({
	server: getServer,
	registry: outboxRegistry,
	secret: env.CRON_SECRET,
	batchSize: 100,
});
