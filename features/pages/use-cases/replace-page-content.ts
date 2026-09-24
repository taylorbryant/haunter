import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { useCase } from "@/lib/use-case";
import {
	PageEditOutputSchema,
	ReplacePageContentInputSchema,
} from "../block-editing";
import { writePageDocument } from "../lib/write-page-document";
import { type BlockJson, MAX_INITIAL_PAGE_CONTENT_BLOCKS } from "../schemas";

export const replacePageContentUseCase = useCase
	.command("pages.replacePageContent")
	.input(ReplacePageContentInputSchema)
	.output(PageEditOutputSchema)
	.run(({ ctx, input }) =>
		writePageDocument(ctx, input, async (tx, scope) => {
			let blocks: BlockJson[];
			if (input.content.format === "blocks") blocks = input.content.blocks;
			else {
				const { markdownToBlocks, MarkdownBlockLimitError } = await import(
					"../lib/markdown"
				);
				try {
					blocks = markdownToBlocks(input.content.markdown, {
						maxBlocks: MAX_INITIAL_PAGE_CONTENT_BLOCKS,
					});
				} catch (error) {
					if (error instanceof MarkdownBlockLimitError)
						throw appError("InvalidPageContent", { message: error.message });
					throw error;
				}
			}
			const result = await tx.documents.restoreBody(
				scope,
				input.id,
				blocks,
				input.expectedRevision,
				"replacement",
			);
			return {
				...result,
				generation: result.documentGeneration,
				insertedBlockIds: [],
			};
		}),
	);
