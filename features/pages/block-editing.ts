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
export const MAX_TABLE_ROWS = 200;
export const MAX_TABLE_COLUMNS = 50;
const TableWidthSchema = z.number().int().positive().max(10_000).nullable();
export const EditableTableCellSchema = z.union([
	EditableInlineSchema,
	z
		.object({
			type: z.literal("tableCell"),
			content: EditableInlineSchema,
			props: z
				.object({
					backgroundColor: z.string().max(100).optional(),
					textColor: z.string().max(100).optional(),
					textAlignment: z
						.enum(["left", "center", "right", "justify"])
						.optional(),
					colspan: z.literal(1).optional(),
					rowspan: z.literal(1).optional(),
				})
				.strict()
				.optional(),
		})
		.strict(),
]);
export const EditableTableContentSchema = z
	.object({
		type: z.literal("tableContent"),
		columnWidths: z
			.array(TableWidthSchema.optional())
			.max(MAX_TABLE_COLUMNS)
			.optional(),
		headerRows: z.number().int().min(0).max(MAX_TABLE_ROWS).optional(),
		headerCols: z.number().int().min(0).max(MAX_TABLE_COLUMNS).optional(),
		rows: z
			.array(
				z
					.object({
						cells: z
							.array(EditableTableCellSchema)
							.min(1)
							.max(MAX_TABLE_COLUMNS),
					})
					.strict(),
			)
			.min(1)
			.max(MAX_TABLE_ROWS),
	})
	.strict()
	.superRefine((table, ctx) => {
		const columns = table.rows[0]?.cells.length ?? 0;
		if (table.rows.some((row) => row.cells.length !== columns))
			ctx.addIssue({
				code: "custom",
				message: "Every table row must have the same number of cells.",
			});
		if (table.columnWidths && table.columnWidths.length !== columns)
			ctx.addIssue({
				code: "custom",
				message: "Provide one width per table column, or omit columnWidths.",
			});
		if (
			(table.headerRows ?? 0) > table.rows.length ||
			(table.headerCols ?? 0) > columns
		)
			ctx.addIssue({
				code: "custom",
				message: "Table headers must fit inside the table.",
			});
	});
export type EditableTableContent = z.infer<typeof EditableTableContentSchema>;

const NewInlineBlockSchema = z
	.object({
		type: EditableBlockTypeSchema,
		props: PropsSchema.optional(),
		content: EditableInlineSchema.optional(),
	})
	.strict();
export const NewPageBlockSchema = z.union([
	NewInlineBlockSchema,
	z
		.object({
			type: z.literal("table"),
			props: PropsSchema.optional(),
			content: EditableTableContentSchema,
		})
		.strict(),
]);

const TableTarget = { blockId: BlockIdSchema };
export const TableOperationSchema = z.discriminatedUnion("op", [
	z
		.object({
			...TableTarget,
			op: z.literal("update_table_cell"),
			row: z
				.number()
				.int()
				.min(0)
				.max(MAX_TABLE_ROWS - 1),
			column: z
				.number()
				.int()
				.min(0)
				.max(MAX_TABLE_COLUMNS - 1),
			content: EditableInlineSchema,
		})
		.strict(),
	z
		.object({
			...TableTarget,
			op: z.literal("insert_table_row"),
			index: z.number().int().min(0).max(MAX_TABLE_ROWS),
			cells: z.array(EditableTableCellSchema).min(1).max(MAX_TABLE_COLUMNS),
		})
		.strict(),
	z
		.object({
			...TableTarget,
			op: z.literal("insert_table_column"),
			index: z.number().int().min(0).max(MAX_TABLE_COLUMNS),
			cells: z.array(EditableTableCellSchema).min(1).max(MAX_TABLE_ROWS),
			width: TableWidthSchema.optional(),
		})
		.strict(),
	z
		.object({
			...TableTarget,
			op: z.literal("delete_table_row"),
			index: z
				.number()
				.int()
				.min(0)
				.max(MAX_TABLE_ROWS - 1),
		})
		.strict(),
	z
		.object({
			...TableTarget,
			op: z.literal("delete_table_column"),
			index: z
				.number()
				.int()
				.min(0)
				.max(MAX_TABLE_COLUMNS - 1),
		})
		.strict(),
]);
export type TableOperation = z.infer<typeof TableOperationSchema>;

export const PageBlockOperationSchema = z.discriminatedUnion("op", [
	...TableOperationSchema.options,
	z
		.object({
			op: z.literal("move"),
			blockId: BlockIdSchema,
			parentBlockId: BlockIdSchema.nullable().optional(),
			afterBlockId: BlockIdSchema.nullable(),
		})
		.strict(),
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
