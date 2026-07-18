import "@beignet/core/server-only";
import {
	reconcilePageDerivations,
	reconcilePageLinks,
} from "@/features/pages/lib/apply-page-content";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import { createSubpageLinkBlock } from "@/features/pages/lib/subpage-link-block";
import type { BlockJson, Page } from "@/features/pages/schemas";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CreatePageInputSchema, CreatePageOutputSchema } from "../schemas";

const PARENT_APPEND_ATTEMPTS = 3;

export const createPageUseCase = useCase
	.command("pages.create")
	.input(CreatePageInputSchema)
	.output(CreatePageOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("pages.create");
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		const result = await ctx.ports.uow.transaction(async (tx) => {
			const parentPageId = input.parentPageId ?? null;
			let parentContentUpdatedAt: string | null = null;
			let parent: Page | null = null;
			if (parentPageId) {
				parent = await tx.pages.findById(scope, parentPageId);
				if (!parent || parent.deletedAt !== null) {
					throw appError("PageNotFound", { details: { id: parentPageId } });
				}
				await ctx.gate.authorize("pages.update", parent);
			}

			const position =
				(await tx.pages.maxPositionForParent(scope, parentPageId)) + 1;

			let created = await tx.pages.create(scope, {
				userId: user.id,
				parentPageId,
				title: input.title,
				position,
			});

			if (input.initialContent && input.initialContent.length > 0) {
				const saved = await tx.pages.saveContent(
					scope,
					created.id,
					JSON.stringify(input.initialContent),
					extractPageSearchText(input.initialContent),
				);
				await reconcilePageDerivations(
					tx,
					scope,
					created,
					input.initialContent,
					{ defaultTaskAssigneeId: user.id },
				);
				created = { ...created, ...saved };
			}

			if (parent && input.appendToParentContent !== false) {
				const pageLinkBlock = createSubpageLinkBlock(created);
				let currentParent = parent;
				let savedContent: BlockJson[] | null = null;

				for (let attempt = 0; attempt < PARENT_APPEND_ATTEMPTS; attempt += 1) {
					const content = [...currentParent.content, pageLinkBlock];
					const saved = await tx.pages.saveContentIf(
						scope,
						currentParent.id,
						JSON.stringify(content),
						extractPageSearchText(content),
						currentParent.contentUpdatedAt,
					);
					if (saved) {
						savedContent = content;
						parentContentUpdatedAt = saved.contentUpdatedAt;
						break;
					}

					const refreshed = await tx.pages.findById(scope, currentParent.id);
					if (!refreshed || refreshed.deletedAt !== null) {
						throw appError("PageNotFound", {
							details: { id: currentParent.id },
						});
					}
					currentParent = refreshed;
				}

				if (!savedContent) {
					throw appError("StaleWrite", { details: { id: currentParent.id } });
				}
				await reconcilePageLinks(tx, scope, currentParent, savedContent);
			}

			return { ...created, parentContentUpdatedAt };
		});

		if (
			result.parentPageId &&
			result.parentContentUpdatedAt &&
			input.appendToParentContent !== false
		) {
			try {
				await ctx.ports.pageCollaboration.publishSubpageLink({
					parentPageId: result.parentPageId,
					parentContentUpdatedAt: result.parentContentUpdatedAt,
					child: result,
				});
			} catch (error) {
				// SQLite already committed. A collaboration transport failure must not
				// make a successful create look failed and invite a duplicate retry.
				ctx.ports.logger.warn(
					"Failed to propagate a subpage link to collaboration",
					{
						error,
						parentPageId: result.parentPageId,
						pageId: result.id,
					},
				);
			}
		}

		return result;
	});
