import { z } from "zod";

const Coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const Dimension = z.number().finite().min(1).max(10_000);
const ShapeId = z
	.string()
	.regex(/^shape:.+/)
	.max(200);
const Ref = z.string().regex(/^[a-zA-Z][\w-]{0,63}$/);
const Target = z.union([ShapeId, Ref]);
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
	z
		.object({
			op: z.literal("create"),
			ref: Ref,
			type: z.enum(["rectangle", "ellipse", "diamond", "text", "note"]),
			x: Coordinate,
			y: Coordinate,
			width: Dimension.optional(),
			height: Dimension.optional(),
			text: Text.optional(),
			color: Color.optional(),
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
export const DeleteCanvasShapesInputSchema = CanvasTargetSchema.extend({
	expectedRevision: CanvasRevisionSchema,
	shapeIds: z.array(ShapeId).min(1).max(100),
});
export const ReadCanvasInputSchema = CanvasTargetSchema.extend({
	historyVersionId: z.uuid().optional(),
});
export const CanvasCommandSchema = z.discriminatedUnion("action", [
	ReadCanvasInputSchema.extend({ action: z.literal("read") }),
	EditCanvasInputSchema.extend({ action: z.literal("edit") }),
	DeleteCanvasShapesInputSchema.extend({ action: z.literal("delete") }),
]);
export type CanvasCommand = z.infer<typeof CanvasCommandSchema>;
export type CanvasOperation = z.infer<typeof CanvasOperationSchema>;
export const CanvasReadOutputSchema = z.object({
	canvasId: z.uuid(),
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
export const CanvasCommandOutputSchema = z.union([
	CanvasReadOutputSchema,
	CanvasEditOutputSchema,
]);
export type CanvasCommandOutput = z.infer<typeof CanvasCommandOutputSchema>;
export const canvasRevision = (canvasId: string, revision: number) =>
	`canvas-v1:${canvasId}:${revision}`;
