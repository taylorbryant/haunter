import { z } from "zod";

export const SearchCanvasLibraryInputSchema = z
	.object({
		workspaceId: z.string().min(1),
		query: z.string().max(200).optional(),
		kind: z.enum(["component", "template"]).optional(),
		category: z.enum(["architecture", "wireframes"]).optional(),
		limit: z.number().int().min(1).max(50).default(50),
		offset: z.number().int().min(0).max(10_000).default(0),
	})
	.strict();

export const SearchCanvasLibraryOutputSchema = z.object({
	total: z.number().int().nonnegative(),
	items: z
		.array(
			z.object({
				id: z.string(),
				version: z.number().int().positive(),
				name: z.string(),
				description: z.string(),
				kind: z.enum(["component", "template"]),
				category: z.enum(["architecture", "wireframes"]),
				keywords: z.array(z.string()),
				width: z.number(),
				height: z.number(),
				shapeCount: z.number().int().positive(),
			}),
		)
		.max(50),
});
