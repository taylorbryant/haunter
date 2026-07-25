import { z } from "zod";
import type { AppContext } from "@/app-context";
import {
	OAUTH_DCR_CLEANUP_LIMIT,
	OAUTH_DCR_UNUSED_CLIENT_TTL_MS,
} from "@/lib/oauth-dcr-request";
import { defineSchedule } from "@/lib/schedules";

export const CleanupOauthClientsSchedulePayloadSchema = z.object({
	at: z.string().datetime(),
});

export type CleanupOauthClientsSchedulePayload = z.infer<
	typeof CleanupOauthClientsSchedulePayloadSchema
>;

export async function cleanupUnusedOAuthClients(ctx: AppContext, at: Date) {
	const cutoff = new Date(at.getTime() - OAUTH_DCR_UNUSED_CLIENT_TTL_MS);
	return ctx.ports.mcpOAuthClients.retireUnusedDynamicBefore(
		cutoff,
		OAUTH_DCR_CLEANUP_LIMIT,
	);
}

export const CleanupOauthClientsSchedule = defineSchedule(
	"agents.cleanup-oauth-clients",
	{
		cron: "0 3 * * *",
		timezone: "UTC",
		payload: CleanupOauthClientsSchedulePayloadSchema,
		createPayload({ run }) {
			return {
				at: (run.scheduledAt ?? run.triggeredAt).toISOString(),
			};
		},
		async handle({ payload, ctx }) {
			const retired = await cleanupUnusedOAuthClients(
				ctx,
				new Date(payload.at),
			);
			ctx.ports.logger.info("Unused OAuth clients retired", {
				scheduleName: "agents.cleanup-oauth-clients",
				retired,
			});
		},
	},
);
