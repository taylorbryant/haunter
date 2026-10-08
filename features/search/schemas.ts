import { z } from "zod";

export const SearchKindSchema = z.enum(["all", "page", "task", "canvas"]);
export const SearchQuerySchema = z.object({
	query: z.string().trim().min(2).max(200),
	kind: SearchKindSchema.default("all"),
	limit: z.number().int().min(1).max(50).default(20),
	cursor: z.string().max(4096).optional(),
});
export const SearchWorkspaceInputSchema = SearchQuerySchema.extend({
	workspaceId: z.string().min(1),
});
export const SearchResultSchema = z.object({
	kind: z.enum(["page", "task", "canvas"]),
	id: z.uuid(),
	workspaceId: z.string(),
	title: z.string(),
	icon: z.string().nullable(),
	snippet: z.string(),
	pageId: z.uuid().nullable(),
	pageTitle: z.string().nullable(),
	shapeId: z.string().nullable(),
	completed: z.boolean().nullable(),
	updatedAt: z.string(),
	path: z.string(),
});
export const SearchWorkspaceOutputSchema = z.object({
	items: z.array(SearchResultSchema),
	nextCursor: z.string().nullable(),
});
export type SearchKind = z.infer<typeof SearchKindSchema>;
export type SearchWorkspaceInput = z.infer<typeof SearchWorkspaceInputSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
