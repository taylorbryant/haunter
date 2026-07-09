import "@beignet/core/server-only";
import { z } from "zod";
import { appError } from "@/features/shared/errors";
import {
	isValidTimezone,
	NotificationSettingsSchema,
	UpdateNotificationPreferencesSchema,
} from "@/features/notifications/schemas";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

function withPushSettings(
	preferences: { overdueTasksEnabled: boolean; timezone: string },
	push: { isConfigured(): boolean; publicKey(): string | null },
) {
	return {
		...preferences,
		pushSupported: push.isConfigured(),
		vapidPublicKey: push.publicKey(),
	};
}

export const getNotificationSettingsUseCase = useCase
	.query("notifications.getSettings")
	.input(z.object({}))
	.output(NotificationSettingsSchema)
	.run(async ({ ctx }) => {
		const user = requireUser(ctx);
		return withPushSettings(
			await ctx.ports.notificationInbox.getPreferences(user.id),
			ctx.ports.webPush,
		);
	});

export const updateNotificationSettingsUseCase = useCase
	.command("notifications.updateSettings")
	.input(UpdateNotificationPreferencesSchema)
	.output(NotificationSettingsSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		if (input.timezone && !isValidTimezone(input.timezone)) {
			throw appError("PushUnavailable", {
				message: "Choose a valid timezone.",
			});
		}
		return withPushSettings(
			await ctx.ports.notificationInbox.updatePreferences(user.id, input),
			ctx.ports.webPush,
		);
	});
