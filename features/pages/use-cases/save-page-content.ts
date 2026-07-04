import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { reconcilePageDerivations } from "../lib/apply-page-content";
import {
	SavePageContentInputSchema,
	SavePageContentOutputSchema,
} from "../schemas";

/** At most one automatic checkpoint per page per interval. */
const CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;
/** Versions kept per page; older ones are pruned. */
export const VERSION_RETENTION = 50;

export const savePageContentUseCase = useCase
	.command("pages.saveContent")
	.input(SavePageContentInputSchema)
	.output(SavePageContentOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);

		return ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(input.id);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.update", page);

			// Checkpoint the pre-save state (not the incoming one) at most once
			// per interval, so history always contains a restore point that
			// predates the current editing burst.
			const latestVersionAt = await tx.pageVersions.latestCreatedAt(page.id);
			const due =
				latestVersionAt === null ||
				Date.now() - Date.parse(latestVersionAt) >= CHECKPOINT_INTERVAL_MS;
			if (due) {
				const current = await tx.pages.findById(page.id);
				if (current && current.content.length > 0) {
					await tx.pageVersions.create({
						pageId: page.id,
						workspaceId: page.workspaceId,
						title: current.title,
						icon: current.icon,
						contentJson: JSON.stringify(current.content),
						cause: "checkpoint",
						createdBy: user.id,
					});
					await tx.pageVersions.prune(page.id, VERSION_RETENTION);
				}
			}

			// With a precondition, refuse to clobber a newer version (another
			// member or another tab saved since this client loaded the doc);
			// without one (internal writes like task write-through) fall back
			// to last-write-wins.
			const contentJson = JSON.stringify(input.content);
			const result = input.baseUpdatedAt
				? await tx.pages.saveContentIf(
						input.id,
						contentJson,
						input.baseUpdatedAt,
					)
				: await tx.pages.saveContent(input.id, contentJson);
			if (result === null) {
				throw appError("StaleWrite", { details: { id: input.id } });
			}

			// The saved document is the source of truth for its task blocks and
			// outgoing page links.
			await reconcilePageDerivations(tx, page, input.content);

			return result;
		});
	});
