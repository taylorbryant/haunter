import { createScheduleRoute } from "@beignet/next";
import { CheckOverdueSchedule } from "@/features/tasks/schedules/check-overdue";
import { env } from "@/lib/env";
import { getServer } from "@/server";

export const runtime = "nodejs";

export const { GET, POST } = createScheduleRoute({
	server: getServer,
	schedules: [CheckOverdueSchedule],
	schedule: CheckOverdueSchedule.name,
	secret: env.CRON_SECRET,
	source: "cron-route",
});
