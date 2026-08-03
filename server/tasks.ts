import { defineTasks, type TaskRunContextArgs } from "@beignet/core/tasks";
import { createServiceActor } from "@beignet/core/ports";
import type { AppContext } from "@/app-context";
import { adminTasks } from "../features/admin/tasks";
import { documentTasks } from "../features/documents/tasks";
import { getServer } from "./index";

export const tasks = defineTasks([...adminTasks, ...documentTasks] as const);

export async function createTaskContext(
	args?: TaskRunContextArgs,
): Promise<AppContext> {
	const server = await getServer();
	return server.createServiceContext({
		// `--tenant` flows through TaskRunContextArgs; the starter has no tenant
		// lookup, so the raw value scopes the service context directly.
		tenantId: args?.tenant,
		actor: createServiceActor("beignet-cli"),
	});
}

export async function stopTaskContext(): Promise<void> {
	const server = await getServer();
	await server.stop();
}
