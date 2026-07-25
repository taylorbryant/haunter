import { createScheduleRoute } from "@beignet/next";
import { CleanupOauthClientsSchedule } from "@/features/agents/schedules/cleanup-oauth-clients";
import { env } from "@/lib/env";
import { getServer } from "@/server";

export const runtime = "nodejs";

export const { GET, POST } = createScheduleRoute({
	server: getServer,
	schedules: [CleanupOauthClientsSchedule],
	schedule: CleanupOauthClientsSchedule.name,
	secret: env.CRON_SECRET,
	source: "cron-route",
});
