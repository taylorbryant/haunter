import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	SavePageContentInputSchema,
	SavePageContentOutputSchema,
} from "../schemas";
export { VERSION_RETENTION } from "../lib/checkpoint-page";

/** Reject pre-cutover tabs without allowing a JSON snapshot to overwrite Yjs. */
export const savePageContentUseCase = useCase
	.command("pages.saveContent")
	.input(SavePageContentInputSchema)
	.output(SavePageContentOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);
		const page = await ctx.ports.pages.findMetaById(scope, input.id);
		if (!page || page.deletedAt !== null) throw appError("PageNotFound");
		await ctx.gate.authorize("pages.update", page);
		throw appError("StaleWrite", {
			message:
				"This editor version can no longer save page bodies. Preserve any unsynced text, then reload the app.",
		});
	});
