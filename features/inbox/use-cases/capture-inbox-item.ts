import "@beignet/core/server-only";
import {
	CaptureInboxItemInputSchema,
	type InboxItem,
	InboxItemSchema,
} from "@/features/inbox/schemas";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import type { BlockJson } from "@/features/pages/schemas";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

function buildNoteDetails(pageId: string, details: string): BlockJson[] {
	return details
		.trim()
		.split(/\r?\n/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.map((paragraph, index) => ({
			id: `${pageId}-${index + 1}`,
			type: "paragraph",
			props: {
				backgroundColor: "default",
				textColor: "default",
				textAlignment: "left",
			},
			content: [{ type: "text", text: paragraph, styles: {} }],
			children: [],
		}));
}

export const captureInboxItemUseCase = useCase
	.command("inbox.capture")
	.input(CaptureInboxItemInputSchema)
	.output(InboxItemSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		return ctx.ports.uow.transaction(async (tx): Promise<InboxItem> => {
			if (input.kind === "page") {
				await ctx.gate.authorize("pages.create");
				const position = (await tx.pages.maxPositionForParent(scope, null)) + 1;
				let page = await tx.pages.create(scope, {
					userId: user.id,
					parentPageId: null,
					title: input.title,
					position,
				});

				const content = input.details
					? buildNoteDetails(page.id, input.details)
					: [];
				if (content.length > 0) {
					const saved = await tx.pages.saveContent(
						scope,
						page.id,
						JSON.stringify(content),
						extractPageSearchText(content),
					);
					page = { ...page, ...saved };
				}

				const inboxItem = await tx.inboxItems.create(scope, {
					userId: user.id,
					kind: "page",
					pageId: page.id,
					taskId: null,
				});
				return {
					id: inboxItem.id,
					workspaceId: inboxItem.workspaceId,
					kind: "page",
					page,
					task: null,
					createdAt: inboxItem.createdAt,
				};
			}

			await ctx.gate.authorize("tasks.create");
			const task = await tx.tasks.create(scope, {
				userId: user.id,
				pageId: null,
				sourceBlockId: null,
				title: input.title,
				completed: false,
				dueDate: input.dueDate ?? null,
				dueTime: input.dueTime ?? null,
				assigneeId: user.id,
				completedAt: null,
			});
			const inboxItem = await tx.inboxItems.create(scope, {
				userId: user.id,
				kind: "task",
				pageId: null,
				taskId: task.id,
			});
			return {
				id: inboxItem.id,
				workspaceId: inboxItem.workspaceId,
				kind: "task",
				page: null,
				task,
				createdAt: inboxItem.createdAt,
			};
		});
	});
