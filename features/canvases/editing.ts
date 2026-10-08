import { z } from "zod";
import {
	AgentFileSourceSchema,
	hasOneFileSource,
} from "@/features/agents/file-input";

const Coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const Dimension = z.number().finite().min(1).max(10_000);
const ShapeId = z
	.string()
	.regex(/^shape:.+/)
	.max(200);
const Ref = z.string().regex(/^[a-zA-Z][\w-]{0,63}$/);
const Target = z.union([ShapeId, Ref]);
const PageId = z
	.string()
	.regex(/^page:.+/)
	.max(200);
const Targets = z.array(Target).min(2).max(100);
const Color = z.enum([
	"black",
	"grey",
	"light-violet",
	"violet",
	"blue",
	"light-blue",
	"yellow",
	"orange",
	"green",
	"light-green",
	"light-red",
	"red",
	"white",
]);
const Text = z.string().max(5_000);
export const CanvasRevisionSchema = z.string().min(1).max(200);
export const CanvasTargetSchema = z.object({ canvasId: z.uuid() }).strict();
export const CanvasOperationSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("group"), ref: Ref, shapeIds: Targets }).strict(),
	z.object({ op: z.literal("ungroup"), shapeId: Target }).strict(),
	z
		.object({
			op: z.literal("reparent"),
			shapeIds: z.array(Target).min(1).max(100),
			parentId: z.union([Target, PageId]),
		})
		.strict(),
	z
		.object({
			op: z.literal("align"),
			shapeIds: Targets,
			alignment: z.enum([
				"left",
				"center-horizontal",
				"right",
				"top",
				"center-vertical",
				"bottom",
				"center",
			]),
		})
		.strict(),
	z
		.object({
			op: z.literal("distribute"),
			shapeIds: z.array(Target).min(3).max(100),
			direction: z.enum(["horizontal", "vertical"]),
		})
		.strict(),

	z
		.object({
			op: z.literal("create"),
			ref: Ref,
			type: z.enum([
				"rectangle",
				"ellipse",
				"diamond",
				"text",
				"note",
				"frame",
			]),
			x: Coordinate,
			y: Coordinate,
			width: Dimension.optional(),
			height: Dimension.optional(),
			text: Text.optional(),
			color: Color.optional(),
			// New shapes may join an existing group/frame. Coordinates are local
			// to that parent; pageId, when supplied, must match its ancestor page.
			parentId: Target.optional(),
			pageId: z
				.string()
				.regex(/^page:.+/)
				.max(200)
				.optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("update"),
			shapeId: Target,
			x: Coordinate.optional(),
			y: Coordinate.optional(),
			width: Dimension.optional(),
			height: Dimension.optional(),
			text: Text.optional(),
			color: Color.optional(),
		})
		.strict()
		.refine(
			(v) =>
				[v.x, v.y, v.width, v.height, v.text, v.color].some(
					(value) => value !== undefined,
				),
			"Provide a field to update.",
		),
	z
		.object({
			op: z.literal("connect"),
			ref: Ref,
			fromId: Target,
			toId: Target,
			text: Text.optional(),
			color: Color.optional(),
		})
		.strict(),
]);
export const EditCanvasInputSchema = CanvasTargetSchema.extend({
	expectedRevision: CanvasRevisionSchema,
	operations: z.array(CanvasOperationSchema).min(1).max(100),
});
export const InsertCanvasLibraryItemInputSchema = CanvasTargetSchema.extend({
	expectedRevision: CanvasRevisionSchema,
	itemId: z.string().min(1).max(100),
	itemVersion: z.number().int().positive(),
	pageId: z
		.string()
		.regex(/^page:.+/)
		.max(200)
		.optional(),
	x: Coordinate,
	y: Coordinate,
	scale: z.number().finite().min(0.1).max(4).default(1),
});
export const DeleteCanvasShapesInputSchema = CanvasTargetSchema.extend({
	expectedRevision: CanvasRevisionSchema,
	shapeIds: z.array(ShapeId).min(1).max(100),
});
export const ReadCanvasInputSchema = CanvasTargetSchema.extend({
	historyVersionId: z.uuid().optional(),
});
export const RestoreCanvasVersionInputSchema = CanvasTargetSchema.extend({
	historyVersionId: z
		.uuid()
		.describe("A retained history ID from read_canvas."),
	expectedRevision: CanvasRevisionSchema.describe(
		"The current revision from a fresh read_canvas without historyVersionId.",
	),
});
export const PreviewCanvasInputSchema = CanvasTargetSchema.extend({
	pageId: z
		.string()
		.regex(/^page:.+/)
		.max(200)
		.optional(),
	shapeIds: z.array(ShapeId).min(1).max(100).optional(),
	expectedRevision: CanvasRevisionSchema.optional(),
});
export const CanvasImagePlacementSchema = CanvasTargetSchema.extend({
	expectedRevision: CanvasRevisionSchema,
	x: Coordinate.describe(
		"Horizontal position, local to parentId when supplied.",
	),
	y: Coordinate.describe("Vertical position, local to parentId when supplied."),
	width: Dimension.optional().describe(
		"Display width; height preserves the image aspect ratio. Defaults to at most 800.",
	),
	parentId: ShapeId.optional(),
	pageId: PageId.optional(),
});
export const InsertCanvasImageInputSchema = CanvasImagePlacementSchema.extend(
	AgentFileSourceSchema.shape,
)
	.strict()
	.refine(hasOneFileSource, "Supply exactly one of file or inlineFile.");
export const CanvasImageDataSchema = z
	.object({
		name: z.string().max(200),
		mimeType: z.literal("image/png"),
		data: z.string().min(4).max(2_796_204),
		width: z.number().int().positive().max(16_000_000),
		height: z.number().int().positive().max(16_000_000),
	})
	.strict();
export const ReadCanvasImageInputSchema = CanvasTargetSchema.extend({
	shapeId: ShapeId,
	expectedRevision: CanvasRevisionSchema.optional(),
});
export const CanvasImageMetadataSchema = z.object({
	canvasId: z.uuid(),
	revision: CanvasRevisionSchema,
	shapeId: ShapeId,
	name: z.string(),
	mimeType: z.literal("image/png"),
	width: z.number(),
	height: z.number(),
});
export const CanvasImageOutputSchema = CanvasImageMetadataSchema.extend({
	data: z.string(),
});
export const CanvasCommandSchema = z.discriminatedUnion("action", [
	ReadCanvasInputSchema.extend({ action: z.literal("read") }),
	RestoreCanvasVersionInputSchema.extend({ action: z.literal("restore") }),
	ReadCanvasImageInputSchema.extend({ action: z.literal("read-image") }),
	CanvasImagePlacementSchema.extend({
		action: z.literal("insert-image"),
		image: CanvasImageDataSchema,
	}),
	PreviewCanvasInputSchema.extend({ action: z.literal("preview") }),
	EditCanvasInputSchema.extend({ action: z.literal("edit") }),
	InsertCanvasLibraryItemInputSchema.extend({
		action: z.literal("insert-library"),
	}),
	DeleteCanvasShapesInputSchema.extend({ action: z.literal("delete") }),
]);
export type CanvasCommand = z.infer<typeof CanvasCommandSchema>;
export const isCanvasWrite = (command: CanvasCommand) =>
	command.action === "edit" ||
	command.action === "restore" ||
	command.action === "delete" ||
	command.action === "insert-library" ||
	command.action === "insert-image";
export type CanvasOperation = z.infer<typeof CanvasOperationSchema>;
export const CanvasReadOutputSchema = z.object({
	canvasId: z.uuid(),
	pageId: z.uuid().nullable().optional(),
	title: z.string().nullable().optional(),
	revision: CanvasRevisionSchema,
	historyVersionId: z.uuid().optional(),
	pages: z.array(z.object({ id: z.string(), name: z.string() })),
	shapes: z.array(
		z.object({
			id: z.string(),
			type: z.string(),
			parentId: z.string(),
			x: z.number(),
			y: z.number(),
			rotation: z.number(),
			isLocked: z.boolean(),
			text: z.string(),
			props: z.record(z.string(), z.unknown()),
		}),
	),
	bindings: z.array(
		z.object({
			id: z.string(),
			type: z.string(),
			fromId: z.string(),
			toId: z.string(),
			props: z.record(z.string(), z.unknown()),
		}),
	),
	history: z.array(
		z.object({
			id: z.uuid(),
			revision: CanvasRevisionSchema,
			createdAt: z.string(),
		}),
	),
});
export const CanvasEditOutputSchema = z.object({
	canvasId: z.uuid(),
	revision: CanvasRevisionSchema,
	createdShapes: z.record(z.string(), z.string()),
	historyVersionId: z.uuid(),
});
export const RestoreCanvasVersionOutputSchema = z.object({
	canvasId: z.uuid(),
	revision: CanvasRevisionSchema,
	historyVersionId: z
		.uuid()
		.describe("Recovery snapshot saved before this restore."),
	restoredHistoryVersionId: z
		.uuid()
		.describe("The saved version that was restored."),
});
export const InsertCanvasLibraryItemOutputSchema = z.object({
	canvasId: z.uuid(),
	revision: CanvasRevisionSchema,
	historyVersionId: z.uuid(),
	itemId: z.string(),
	itemVersion: z.number().int().positive(),
	pageId: z.string(),
	rootShapeId: ShapeId,
	groupId: ShapeId.nullable(),
	shapeIdsByKey: z.record(z.string(), ShapeId),
});
export const CanvasPreviewMetadataSchema = z.object({
	canvasId: z.uuid(),
	revision: CanvasRevisionSchema,
	pageId: z.string(),
	shapeIds: z.array(z.string()),
	bounds: z.object({
		x: z.number().finite(),
		y: z.number().finite(),
		width: z.number().positive().finite(),
		height: z.number().positive().finite(),
	}),
	width: z.number().int().min(1).max(1600),
	height: z.number().int().min(1).max(1600),
});
export const CanvasPreviewOutputSchema = CanvasPreviewMetadataSchema.extend({
	image: z.object({
		mimeType: z.literal("image/png"),
		data: z.string().min(1).max(3_000_000),
	}),
});
export type CanvasPreviewOutput = z.infer<typeof CanvasPreviewOutputSchema>;
export const CanvasCommandOutputSchema = z.union([
	CanvasReadOutputSchema,
	CanvasEditOutputSchema,
	RestoreCanvasVersionOutputSchema,
	InsertCanvasLibraryItemOutputSchema,
	CanvasPreviewOutputSchema,
	CanvasImageOutputSchema,
]);
export type CanvasCommandOutput = z.infer<typeof CanvasCommandOutputSchema>;
export const canvasRevision = (canvasId: string, revision: number) =>
	`canvas-v1:${canvasId}:${revision}`;
