import { defineOutboxRegistry } from "@beignet/core/outbox";
import { createServiceActor } from "@beignet/core/ports";
import type { AppContext } from "@/app-context";
import { documentJobs } from "@/features/documents/jobs";
import { getServer } from "./index";

export const outboxRegistry = defineOutboxRegistry({
	events: [],
	jobs: [...documentJobs],
});

export async function createOutboxDrainContext(): Promise<AppContext> {
	const server = await getServer();
	return server.createServiceContext({
		actor: createServiceActor("beignet-outbox"),
	});
}

export async function stopOutboxDrainContext(): Promise<void> {
	const server = await getServer();
	await server.stop();
}
