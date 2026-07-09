import "@beignet/core/server-only";
import { z } from "zod";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	MarkNotificationsReadOutputSchema,
	NotificationIdInputSchema,
} from "../schemas";

export const markNotificationReadUseCase = useCase
	.command("notifications.markRead")
	.input(NotificationIdInputSchema)
	.output(MarkNotificationsReadOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		if (!(await ctx.ports.notificationInbox.markRead(user.id, input.id))) {
			throw appError("NotificationNotFound");
		}
		return {
			unreadCount: await ctx.ports.notificationInbox.countUnread(user.id),
		};
	});

export const markAllNotificationsReadUseCase = useCase
	.command("notifications.markAllRead")
	.input(z.object({}))
	.output(MarkNotificationsReadOutputSchema)
	.run(async ({ ctx }) => {
		const user = requireUser(ctx);
		await ctx.ports.notificationInbox.markAllRead(user.id);
		return { unreadCount: 0 };
	});
