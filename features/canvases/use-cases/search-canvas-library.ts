import "@beignet/core/server-only";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { searchCanvasLibraryItems } from "../lib/library";
import {
	SearchCanvasLibraryInputSchema,
	SearchCanvasLibraryOutputSchema,
} from "../library-schemas";

export const searchCanvasLibraryUseCase = useCase
	.query("canvases.searchLibrary")
	.input(SearchCanvasLibraryInputSchema)
	.output(SearchCanvasLibraryOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);
		requireActiveWorkspaceScope(ctx, input.workspaceId);
		const matches = searchCanvasLibraryItems(
			input.query ?? "",
			input.kind,
			input.category,
		);
		return {
			total: matches.length,
			items: matches
				.slice(input.offset, input.offset + input.limit)
				.map(({ preview: _, elements, ...item }) => ({
					...item,
					shapeCount: elements.length,
				})),
		};
	});
