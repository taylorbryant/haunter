import { z } from "zod";
import { defineSchedule } from "@/lib/schedules";

export const CleanupRecoveryPartsSchedulePayloadSchema = z.object({
	date: z.string().datetime(),
});

export type CleanupRecoveryPartsSchedulePayload = z.infer<
	typeof CleanupRecoveryPartsSchedulePayloadSchema
>;

export const CleanupRecoveryPartsSchedule = defineSchedule(
	"documents.cleanup-recovery-parts",
	{
		cron: "0 4 * * *",
		timezone: "UTC",
		payload: CleanupRecoveryPartsSchedulePayloadSchema,
		createPayload({ run }) {
			const date = run.scheduledAt ?? run.triggeredAt;

			return {
				date: date.toISOString(),
			};
		},
		async handle({ payload, ctx }) {
			await ctx.ports.documents.purgeExpiredRecoveryParts(
				Date.parse(payload.date),
			);
		},
	},
);
