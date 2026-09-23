import "@beignet/core/server-only";
import { documentRevision } from "@/features/documents/revision";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageDocumentOutputSchema } from "../block-editing";
import { PageIdInputSchema } from "../schemas";

export const readPageDocumentUseCase = useCase
	.query("pages.readPageDocument")
	.input(PageIdInputSchema)
	.output(PageDocumentOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);
		// Read the SQL body projection and its document token from one snapshot.
		return ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findById(scope, input.id);
			if (!page || page.deletedAt !== null) throw appError("PageNotFound");
			await ctx.gate.authorize("pages.read", page);
			const document = await tx.documents.find(scope, page.id);
			if (!document)
				throw appError("InvalidPageContent", {
					message: "The page body has not been migrated.",
				});
			return {
				pageId: page.id,
				title: page.title,
				updatedAt: page.updatedAt,
				revision: documentRevision(document),
				blocks: page.content,
			};
		});
	});
