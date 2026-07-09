import "@beignet/core/server-only";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	ListNotificationsInputSchema,
	ListNotificationsOutputSchema,
} from "../schemas";

function decodeCursor(cursor?: string) {
	if (!cursor) return undefined;
	try {
		const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
		if (typeof value.createdAt === "string" && typeof value.id === "string") {
			return { createdAt: value.createdAt, id: value.id };
		}
	} catch {
		// Invalid cursors behave like the first page instead of causing a 500.
	}
	return undefined;
}

function encodeCursor(cursor: { createdAt: string; id: string } | null) {
	return cursor
		? Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
		: null;
}

export const listNotificationsUseCase = useCase
	.query("notifications.list")
	.input(ListNotificationsInputSchema)
	.output(ListNotificationsOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const [page, unreadCount] = await Promise.all([
			ctx.ports.notificationInbox.listByUser(user.id, {
				cursor: decodeCursor(input.cursor),
				limit: input.limit,
			}),
			ctx.ports.notificationInbox.countUnread(user.id),
		]);
		return {
			items: page.items,
			unreadCount,
			nextCursor: encodeCursor(page.nextCursor),
		};
	});
