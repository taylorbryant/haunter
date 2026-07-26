import "@beignet/core/server-only";
import { z } from "zod";
import {
	InitializeNotificationTimezoneSchema,
	isValidTimezone,
	NotificationSettingsSchema,
	UpdateNotificationPreferencesSchema,
} from "@/features/notifications/schemas";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

function withPushSettings(
	preferences: {
		overdueTasksEnabled: boolean;
		taskAssignmentsEnabled: boolean;
		timezone: string;
		timezoneConfigured: boolean;
	},
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
			throw appError("InvalidTimezone");
		}
		return withPushSettings(
			await ctx.ports.notificationInbox.updatePreferences(user.id, input),
			ctx.ports.webPush,
		);
	});

export const initializeNotificationTimezoneUseCase = useCase
	.command("notifications.initializeTimezone")
	.input(InitializeNotificationTimezoneSchema)
	.output(NotificationSettingsSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		if (!isValidTimezone(input.timezone)) {
			throw appError("InvalidTimezone");
		}
		return withPushSettings(
			await ctx.ports.notificationInbox.initializeTimezone(
				user.id,
				input.timezone,
			),
			ctx.ports.webPush,
		);
	});
