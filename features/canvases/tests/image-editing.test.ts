import { expect, test } from "bun:test";
import sharp from "sharp";
import type { TLAssetId, TLShapeId, TLRecord } from "@tldraw/tlschema";
import { normalizeCanvasSnapshot } from "../lib/document";
import {
	prepareCanvasImageInsertion,
	readCanvasImage,
} from "@/infra/canvases/image-edits";
import { prepareCanvasEdit } from "@/infra/canvases/shape-edits";
import { createCanvasPreviewRenderer } from "@/infra/canvases/preview-renderer";

async function imageFixture() {
	const bytes = await sharp({
		create: { width: 24, height: 16, channels: 3, background: "red" },
	})
		.png()
		.toBuffer();
	const command = {
		action: "insert-image" as const,
		canvasId: crypto.randomUUID(),
		expectedRevision: "test",
		x: 20,
		y: 40,
		image: {
			name: "red.png",
			mimeType: "image/png" as const,
			width: 24,
			height: 16,
			data: bytes.toString("base64"),
		},
	};
	const inserted = await prepareCanvasImageInsertion(
		normalizeCanvasSnapshot({}),
		command,
	);
	const shapeId = inserted.createdShapes.image as TLShapeId;
	const shape = inserted.next.store[shapeId];
	if (
		shape.typeName !== "shape" ||
		shape.type !== "image" ||
		!shape.props.assetId
	)
		throw new Error("Missing image");
	return { ...inserted, command, shape, shapeId, assetId: shape.props.assetId };
}

test("deleting images removes only unused assets and preserves the recovery source", async () => {
	const f = await imageFixture();
	const copyId = "shape:copy" as TLShapeId;
	f.next.store[copyId] = {
		...f.shape,
		id: copyId,
		x: 200,
		index: "a2" as never,
	};
	const once = prepareCanvasEdit(f.next, {
		action: "delete",
		canvasId: f.command.canvasId,
		expectedRevision: "test",
		shapeIds: [f.shapeId],
	});
	expect(once.next.store[f.assetId]).toBeDefined();
	const twice = prepareCanvasEdit(once.next, {
		action: "delete",
		canvasId: f.command.canvasId,
		expectedRevision: "test",
		shapeIds: [copyId],
	});
	expect(twice.next.store[f.assetId]).toBeUndefined();
	expect(twice.deleted).toContain(f.assetId);
	expect(f.next.store[f.assetId]).toBeDefined();
});

test("canvas reads normalize existing web-uploaded JPEGs, reject external assets and do not mutate the source", async () => {
	const f = await imageFixture();
	const jpeg = await sharp({
		create: { width: 32, height: 24, channels: 3, background: "blue" },
	})
		.jpeg()
		.toBuffer();
	const asset = f.next.store[f.assetId];
	if (asset.typeName !== "asset" || asset.type !== "image")
		throw new Error("Missing asset");
	asset.props.src = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
	asset.props.mimeType = "image/jpeg";
	const before = JSON.stringify(f.next);
	expect(await readCanvasImage(f.next, f.shapeId)).toMatchObject({
		mimeType: "image/png",
		width: 32,
		height: 24,
	});
	expect(JSON.stringify(f.next)).toBe(before);
	asset.props.src = "https://127.0.0.1/private.png";
	await expect(readCanvasImage(f.next, f.shapeId)).rejects.toThrow(
		"External images are not fetched",
	);
	const renderer = createCanvasPreviewRenderer();
	try {
		const error = await renderer
			.render({
				snapshot: f.next,
				command: { action: "preview", canvasId: f.command.canvasId },
			})
			.then(
				() => null,
				(error) => error,
			);
		expect(error).toMatchObject({ code: "INVALID_CANVAS_PREVIEW" });
	} finally {
		await renderer.stop();
	}
});

test("image insertion validates parent locks, page identity and the existing total storage bound", async () => {
	const f = await imageFixture();
	const frameId = "shape:frame" as TLShapeId;
	f.next.store[frameId] = {
		...f.shape,
		id: frameId,
		type: "frame",
		isLocked: true,
		index: "a2" as never,
		props: { w: 500, h: 500, name: "Frame", color: "black" },
	} as TLRecord;
	await expect(
		prepareCanvasImageInsertion(f.next, { ...f.command, parentId: frameId }),
	).rejects.toMatchObject({ code: "INVALID_CANVAS_EDIT" });
	const frame = f.next.store[frameId];
	if (frame.typeName === "shape") frame.isLocked = false;
	const inserted = await prepareCanvasImageInsertion(f.next, {
		...f.command,
		parentId: frameId,
	});
	expect(
		inserted.next.store[inserted.createdShapes.image as TLShapeId],
	).toMatchObject({ parentId: frameId, x: 20, y: 40 });
	await expect(
		prepareCanvasImageInsertion(f.next, {
			...f.command,
			parentId: frameId,
			pageId: "page:other",
		}),
	).rejects.toThrow();
	const asset = f.next.store[f.assetId as TLAssetId];
	asset.meta = { padding: "x".repeat(5_000_000) };
	await expect(prepareCanvasImageInsertion(f.next, f.command)).rejects.toThrow(
		"storage limit",
	);
});
