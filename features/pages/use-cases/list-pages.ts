import "@beignet/core/server-only";
import { documentCacheEpoch } from "@/features/documents/model";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListPagesInputSchema, ListPagesOutputSchema } from "../schemas";

export const listPagesUseCase = useCase
	.query("pages.list")
	.input(ListPagesInputSchema)
	.output(ListPagesOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		const [items, documents] = await Promise.all([
			ctx.ports.pages.listMetaByWorkspace(scope),
			ctx.ports.documents.listByKind(scope, "page"),
		]);
		const epochs = new Map(
			documents.map((document) => [
				document.entityId,
				documentCacheEpoch(document),
			]),
		);
		return {
			items: items.map((page) => ({
				...page,
				documentCacheEpoch: epochs.get(page.id) ?? null,
			})),
		};
	});
