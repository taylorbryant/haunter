import { z } from "zod";
import { CreatePageInputSchema, PageContentSchema } from "./schemas";

export const EditableBlockTypeSchema = z.enum([
	"paragraph",
	"heading",
	"bulletListItem",
	"numberedListItem",
	"task",
	"codeBlock",
	"callout",
	"quote",
	"divider",
	"pageLink",
]);
const BlockIdSchema = z.string().min(1).max(300);
const StylesSchema = z
	.object({
		bold: z.boolean().optional(),
		italic: z.boolean().optional(),
		underline: z.boolean().optional(),
		strike: z.boolean().optional(),
		code: z.boolean().optional(),
		textColor: z.string().optional(),
		backgroundColor: z.string().optional(),
	})
	.strict();
const TextSchema = z
	.object({
		type: z.literal("text"),
		text: z.string().max(100_000),
		styles: StylesSchema.default({}),
	})
	.strict();
export const EditableInlineSchema = z
	.array(
		z.discriminatedUnion("type", [
			TextSchema,
			z
				.object({
					type: z.literal("link"),
					href: z.string().max(4_000),
					content: z.array(TextSchema).max(10_000),
				})
				.strict(),
			z
				.object({
					type: z.literal("mention"),
					props: z
						.object({ pageId: z.string(), workspaceId: z.string() })
						.strict(),
				})
				.strict(),
		]),
	)
	.max(10_000);
const PropsSchema = z.record(
	z.string(),
	z.union([z.string().max(4_000), z.boolean(), z.number().finite()]),
);
export const NewPageBlockSchema = z
	.object({
		type: EditableBlockTypeSchema,
		props: PropsSchema.optional(),
		content: EditableInlineSchema.optional(),
	})
	.strict();

export const PageBlockOperationSchema = z.discriminatedUnion("op", [
	z
		.object({
			op: z.literal("update"),
			blockId: BlockIdSchema,
			props: PropsSchema.optional(),
			content: EditableInlineSchema.optional(),
		})
		.strict()
		.refine(
			(op) => op.props !== undefined || op.content !== undefined,
			"Provide props or content to update.",
		),
	z
		.object({
			op: z.literal("insert"),
			parentBlockId: BlockIdSchema.nullable().optional(),
			afterBlockId: BlockIdSchema.nullable(),
			blocks: z.array(NewPageBlockSchema).min(1).max(1_000),
		})
		.strict(),
	z
		.object({
			op: z.literal("delete"),
			blockId: BlockIdSchema,
			deleteChildren: z.boolean().optional(),
		})
		.strict(),
]);
export type PageBlockOperation = z.infer<typeof PageBlockOperationSchema>;

export const PageRevisionSchema = z.string().min(1).max(200);
export const EditPageBlocksInputSchema = z
	.object({
		id: z.uuid(),
		expectedRevision: PageRevisionSchema,
		operations: z.array(PageBlockOperationSchema).min(1).max(100),
	})
	.strict()
	.refine(
		(value) =>
			new TextEncoder().encode(JSON.stringify(value)).length <= 5_000_000,
		"An edit batch must be 5 MB or smaller.",
	);

export const ReplacePageContentInputSchema = z
	.object({
		id: z.uuid(),
		expectedRevision: PageRevisionSchema,
		content: z.discriminatedUnion("format", [
			z
				.object({
					format: z.literal("markdown"),
					markdown: z.string().max(100_000),
				})
				.strict(),
			z
				.object({
					format: z.literal("blocks"),
					blocks: CreatePageInputSchema.shape.initialContent.unwrap(),
				})
				.strict(),
		]),
	})
	.strict();

export const PageDocumentOutputSchema = z.object({
	pageId: z.uuid(),
	title: z.string(),
	updatedAt: z.string(),
	revision: PageRevisionSchema,
	blocks: PageContentSchema,
});
export const PageEditOutputSchema = z.object({
	pageId: z.uuid(),
	title: z.string(),
	updatedAt: z.string(),
	revision: PageRevisionSchema,
	insertedBlockIds: z.array(z.string()),
	historyVersionId: z.uuid(),
	tasksChanged: z.boolean(),
	linksChanged: z.boolean(),
});
