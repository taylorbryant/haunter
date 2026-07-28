import "@beignet/core/server-only";
import {
	cursorPageResult,
	normalizeCursorPage,
} from "@beignet/core/pagination";
import type { InboxCursor } from "@/features/inbox/ports";
import {
	ListInboxItemsInputSchema,
	ListInboxItemsOutputSchema,
} from "@/features/inbox/schemas";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

function decodeCursor(cursor?: string): InboxCursor | undefined {
	if (!cursor) return undefined;
	try {
		const value: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		);
		if (
			typeof value === "object" &&
			value !== null &&
			"createdAt" in value &&
			"id" in value &&
			typeof value.createdAt === "string" &&
			typeof value.id === "string"
		) {
			return { createdAt: value.createdAt, id: value.id };
		}
	} catch {
		// Invalid cursors restart from the first page.
	}
	return undefined;
}

function encodeCursor(cursor: InboxCursor | null): string | null {
	return cursor
		? Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
		: null;
}

export const listInboxItemsUseCase = useCase
	.query("inbox.list")
	.input(ListInboxItemsInputSchema)
	.output(ListInboxItemsOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);
		const page = normalizeCursorPage(input, {
			defaultLimit: 20,
			maxLimit: 50,
		});
		const cursor = decodeCursor(page.cursor ?? undefined);
		const result = await ctx.ports.inboxItems.listForUser(scope, user.id, {
			limit: page.limit,
			...(cursor ? { cursor } : {}),
		});
		return cursorPageResult(
			result.items,
			page,
			encodeCursor(result.nextCursor),
		);
	});
