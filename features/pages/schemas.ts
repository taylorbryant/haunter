import { z } from "zod";

/**
 * Permissive shape check for a BlockNote block. The editor owns the real
 * schema; the server validates structure only and stores content verbatim.
 */
export type BlockJson = {
	id: string;
	type: string;
	props: Record<string, unknown>;
	content?: unknown;
	children: BlockJson[];
};

export const BlockJsonSchema: z.ZodType<BlockJson> = z.lazy(() =>
	z.object({
		id: z.string(),
		type: z.string(),
		props: z.record(z.string(), z.unknown()).default({}),
		content: z.unknown().optional(),
		children: z.array(BlockJsonSchema).default([]),
	}),
);

export const PageContentSchema = z.array(BlockJsonSchema);

export const PageMetaSchema = z.object({
	id: z.string().uuid(),
	userId: z.string(),
	workspaceId: z.string().min(1),
	parentPageId: z.string().uuid().nullable(),
	title: z.string(),
	icon: z.string().nullable(),
	position: z.number(),
	deletedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export const PageSchema = PageMetaSchema.extend({
	content: PageContentSchema,
});

export const ListPagesInputSchema = z.object({
	workspaceId: z.string().min(1),
});

export const ListPagesOutputSchema = z.object({
	items: z.array(PageMetaSchema),
});

export const PageIdInputSchema = z.object({
	id: z.string().uuid(),
});

export const CreatePageInputSchema = z.object({
	workspaceId: z.string().min(1),
	parentPageId: z.string().uuid().optional(),
	title: z.string().max(300),
});

export const UpdatePageBodySchema = z.object({
	title: z.string().max(300).optional(),
	icon: z.string().max(16).nullable().optional(),
	parentPageId: z.string().uuid().nullable().optional(),
	position: z.number().optional(),
});

export const UpdatePageInputSchema =
	PageIdInputSchema.merge(UpdatePageBodySchema);

export const SavePageContentBodySchema = z.object({
	content: PageContentSchema,
	// Optimistic-concurrency precondition: the updatedAt the client last saw.
	// When present and stale, the save is rejected with 409 instead of
	// clobbering another member's (or another tab's) edits.
	baseUpdatedAt: z.string().datetime().optional(),
});

export const SavePageContentInputSchema = PageIdInputSchema.merge(
	SavePageContentBodySchema,
);

export const SavePageContentOutputSchema = z.object({
	updatedAt: z.string().datetime(),
	tasksChanged: z.boolean(),
	linksChanged: z.boolean(),
});

export const DeletePageOutputSchema = z.void();

export const PageVersionMetaSchema = z.object({
	id: z.string().uuid(),
	pageId: z.string().uuid(),
	title: z.string(),
	icon: z.string().nullable(),
	cause: z.enum(["checkpoint", "restore"]),
	createdBy: z.string(),
	/** Author display name, resolved at read time. */
	createdByName: z.string().nullable(),
	createdAt: z.string().datetime(),
});

export const PageVersionSchema = PageVersionMetaSchema.extend({
	content: PageContentSchema,
});

export const ListPageVersionsOutputSchema = z.object({
	items: z.array(PageVersionMetaSchema),
});

export const PageVersionIdInputSchema = z.object({
	id: z.string().uuid(),
	versionId: z.string().uuid(),
});

export const ListTrashInputSchema = z.object({
	workspaceId: z.string().min(1),
});

export const ListTrashOutputSchema = z.object({
	items: z.array(PageMetaSchema),
});

export const ListBacklinksOutputSchema = z.object({
	items: z.array(PageMetaSchema),
});

export const SearchPagesInputSchema = z.object({
	q: z.string().min(2).max(200),
});

export const SearchResultSchema = z.object({
	id: z.string().uuid(),
	workspaceId: z.string().min(1),
	title: z.string(),
	icon: z.string().nullable(),
	/** Text around the first body match, or the page's opening text. */
	snippet: z.string(),
	updatedAt: z.string().datetime(),
});

export const SearchPagesOutputSchema = z.object({
	items: z.array(SearchResultSchema),
});

export type PageMeta = z.infer<typeof PageMetaSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type Page = z.infer<typeof PageSchema>;
export type CreatePageInput = z.infer<typeof CreatePageInputSchema>;
export type UpdatePageInput = z.infer<typeof UpdatePageInputSchema>;
export type SavePageContentInput = z.infer<typeof SavePageContentInputSchema>;
export type PageVersionMeta = z.infer<typeof PageVersionMetaSchema>;
export type PageVersion = z.infer<typeof PageVersionSchema>;
