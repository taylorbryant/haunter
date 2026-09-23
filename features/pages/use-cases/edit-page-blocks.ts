import "@beignet/core/server-only";
import { useCase } from "@/lib/use-case";
import {
	EditPageBlocksInputSchema,
	PageEditOutputSchema,
} from "../block-editing";
import { writePageDocument } from "../lib/write-page-document";

export const editPageBlocksUseCase = useCase
	.command("pages.editPageBlocks")
	.input(EditPageBlocksInputSchema)
	.output(PageEditOutputSchema)
	.run(({ ctx, input }) =>
		writePageDocument(ctx, input, (tx, scope) =>
			tx.documents.editBlocks(scope, {
				pageId: input.id,
				expectedRevision: input.expectedRevision,
				operations: input.operations,
			}),
		),
	);
