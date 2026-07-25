import { createServiceActor } from "@beignet/core/ports";
import type { AppContext } from "@/app-context";
import { agentSchedules } from "@/features/agents/schedules";
import { taskSchedules } from "@/features/tasks/schedules";
import { getServer } from "./index";

export const schedules = [...taskSchedules, ...agentSchedules] as const;

export async function createScheduleContext(): Promise<AppContext> {
	const server = await getServer();
	return server.createServiceContext({
		actor: createServiceActor("beignet-schedule"),
	});
}

export async function stopScheduleContext(): Promise<void> {
	const server = await getServer();
	await server.stop();
}
