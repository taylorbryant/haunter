import { createScheduleRoute } from "@beignet/next";
import { CleanupRecoveryPartsSchedule } from "@/features/documents/schedules/cleanup-recovery-parts";
import { env } from "@/lib/env";
import { getServer } from "@/server";

export const runtime = "nodejs";

export const { GET, POST } = createScheduleRoute({
	server: getServer,
	schedules: [CleanupRecoveryPartsSchedule],
	schedule: CleanupRecoveryPartsSchedule.name,
	secret: env.CRON_SECRET,
	source: "cron-route",
});
