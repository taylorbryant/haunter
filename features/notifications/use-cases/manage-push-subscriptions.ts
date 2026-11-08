import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	PushSubscriptionEndpointSchema,
	PushSubscriptionOutputSchema,
	PushSubscriptionSchema,
	PushSubscriptionStatusSchema,
	TestPushOutputSchema,
} from "../schemas";

export const subscribePushUseCase = useCase
	.command("notifications.subscribePush")
	.input(PushSubscriptionSchema)
	.output(PushSubscriptionOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		if (!ctx.ports.webPush.isConfigured()) throw appError("PushUnavailable");
		const validation = ctx.ports.webPush.validateSubscription(input);
		if (!validation.valid)
			throw appError(
				validation.reason === "unsupported-service"
					? "UnsupportedPushService"
					: "InvalidPushSubscription",
			);
		await ctx.ports.notificationInbox.upsertPushSubscription(user.id, input);
		return { subscribed: true };
	});

export const getPushSubscriptionStatusUseCase = useCase
	.query("notifications.getPushSubscriptionStatus")
	.input(PushSubscriptionEndpointSchema)
	.output(PushSubscriptionStatusSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		if (!ctx.ports.webPush.isConfigured())
			return { status: "unavailable" as const };
		const subscription = await ctx.ports.notificationInbox.findPushSubscription(
			user.id,
			input.endpoint,
		);
		if (!subscription) return { status: "disabled" as const };
		const validation = ctx.ports.webPush.validateSubscription(subscription);
		return {
			status: validation.valid ? ("enabled" as const) : validation.reason,
		};
	});

export const unsubscribePushUseCase = useCase
	.command("notifications.unsubscribePush")
	.input(PushSubscriptionEndpointSchema)
	.output(PushSubscriptionOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.ports.notificationInbox.deletePushSubscription(
			user.id,
			input.endpoint,
		);
		return { subscribed: false };
	});

export const testPushUseCase = useCase
	.command("notifications.testPush")
	.input(PushSubscriptionEndpointSchema)
	.output(TestPushOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		if (!ctx.ports.webPush.isConfigured()) throw appError("PushUnavailable");
		const subscription = await ctx.ports.notificationInbox.findPushSubscription(
			user.id,
			input.endpoint,
		);
		if (!subscription) return { sent: false };
		const validation = ctx.ports.webPush.validateSubscription(subscription);
		if (!validation.valid)
			throw appError(
				validation.reason === "unsupported-service"
					? "UnsupportedPushService"
					: "InvalidPushSubscription",
			);

		const result = await ctx.ports.webPush.send(subscription, {
			title: "Haunter notifications are on",
			body: "You'll be notified when assigned tasks become overdue.",
			url: "/app",
			tag: `notifications-test:${user.id}`,
			unreadCount: await ctx.ports.notificationInbox.countUnread(user.id),
		});
		if (result.status === "gone") {
			await ctx.ports.notificationInbox.deletePushSubscription(
				user.id,
				input.endpoint,
			);
		}
		return { sent: result.status === "sent" };
	});
