import { expect, test } from "bun:test";
import type { TLPageId, TLRecord, TLShapeId } from "@tldraw/tlschema";
import { chromium } from "playwright";
import { createCanvasPreviewContext } from "@/infra/canvases/preview-context";
import { normalizeCanvasSnapshot } from "../lib/document";
import { PreviewCanvasInputSchema } from "../editing";
import { createCanvasPreviewRenderer } from "@/infra/canvases/preview-renderer";
import { prepareCanvasPreview } from "@/infra/canvases/preview-selection";
import { prepareCanvasEdit } from "@/infra/canvases/shape-edits";

const command = { action: "preview" as const, canvasId: crypto.randomUUID() };

test("preview browser allows bundled assets but cannot contact the worker or external hosts", async () => {
	let requests = 0;
	const probe = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => {
			requests++;
			return new Response("private");
		},
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const origin = `http://127.0.0.1:${probe.port}`;
		const context = await createCanvasPreviewContext(
			browser,
			new Map([
				[
					`${origin}/`,
					{
						body: "<!doctype html><title>Preview</title>",
						contentType: "text/html",
					},
				],
				[`${origin}/asset`, { body: "bundled", contentType: "text/plain" }],
			]),
		);
		const page = await context.newPage();
		await page.goto(origin);
		expect(
			await page.evaluate(() => fetch("/asset").then((r) => r.text())),
		).toBe("bundled");
		for (const url of [
			`${origin}/private`,
			`${origin}/fonts/../private`,
			`http://localhost:${probe.port}/external`,
			"file:///etc/hosts",
		]) {
			expect(
				await page.evaluate(
					(url) =>
						fetch(url).then(
							() => "allowed",
							() => "blocked",
						),
					url,
				),
			).toBe("blocked");
		}
		expect(requests).toBe(0);
	} finally {
		await browser.close();
		await probe.stop(true);
	}
}, 30_000);
function drawing() {
	return prepareCanvasEdit(normalizeCanvasSnapshot({}), {
		action: "edit",
		canvasId: command.canvasId,
		expectedRevision: "test",
		operations: [
			{
				op: "create",
				ref: "api",
				type: "rectangle",
				x: -300,
				y: -50,
				text: "API server",
				color: "blue",
			},
			{
				op: "create",
				ref: "db",
				type: "ellipse",
				x: 250,
				y: -50,
				text: "Database",
				color: "green",
			},
			{ op: "connect", ref: "arrow", fromId: "api", toId: "db", text: "Query" },
			{
				op: "create",
				ref: "note",
				type: "note",
				x: -300,
				y: 250,
				text: "Review diagram",
			},
			{
				op: "create",
				ref: "caption",
				type: "text",
				x: 100,
				y: 260,
				text: "Read → inspect → edit",
			},
		],
	});
}

test("native diagrams render with measurable crop bounds and PNG dimensions without mutating their snapshot", async () => {
	const renderer = createCanvasPreviewRenderer();
	const { next: snapshot, createdShapes } = drawing();
	const before = JSON.stringify(snapshot);
	try {
		const full = await renderer.render({ snapshot, command });
		const cropped = await renderer.render({
			snapshot,
			command: { ...command, shapeIds: [createdShapes.api] },
		});
		for (const result of [full, cropped]) {
			const png = Buffer.from(result.image.data, "base64");
			expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
			expect(png.readUInt32BE(16)).toBe(result.width);
			expect(png.readUInt32BE(20)).toBe(result.height);
			expect(png.length).toBeGreaterThan(1000);
		}
		expect(cropped.bounds).toEqual({
			x: -332,
			y: -82,
			width: 304,
			height: 184,
		});
		expect(cropped.width).toBeLessThan(full.width);
		expect(cropped.shapeIds).toEqual([createdShapes.api]);
		expect(full.shapeIds).toHaveLength(5);
		expect(JSON.stringify(snapshot)).toBe(before);
	} finally {
		await renderer.stop();
	}
}, 30_000);

test("fractional dimensions, rotation and autosized text report actual PNG pixels", async () => {
	const renderer = createCanvasPreviewRenderer();
	const { next: snapshot, createdShapes } = drawing();
	const records: Record<string, TLRecord> = snapshot.store;
	const rectangle = records[createdShapes.api];
	const caption = records[createdShapes.caption];
	if (rectangle.typeName !== "shape" || rectangle.type !== "geo")
		throw new Error("Expected a rectangle");
	if (caption.typeName !== "shape" || caption.type !== "text")
		throw new Error("Expected text");
	rectangle.props.w = 240.5;
	caption.props.autoSize = true;
	const before = JSON.stringify(snapshot);
	try {
		const fractional = await renderer.render({
			snapshot,
			command: { ...command, shapeIds: [rectangle.id] },
		});
		expect(fractional.bounds.width).toBe(304.5);
		expect(fractional.width).toBe(304);
		const text = await renderer.render({
			snapshot,
			command: { ...command, shapeIds: [caption.id] },
		});
		expect(JSON.stringify(snapshot)).toBe(before);
		const rotatedSnapshot = structuredClone(snapshot);
		const rotatedShape = rotatedSnapshot.store[rectangle.id];
		if (rotatedShape.typeName !== "shape") throw new Error("Expected shape");
		rotatedShape.rotation = Math.PI / 7;
		const rotated = await renderer.render({
			snapshot: rotatedSnapshot,
			command: { ...command, shapeIds: [rectangle.id] },
		});
		for (const result of [fractional, text, rotated]) {
			const png = Buffer.from(result.image.data, "base64");
			expect(result.width).toBe(png.readUInt32BE(16));
			expect(result.height).toBe(png.readUInt32BE(20));
		}
	} finally {
		await renderer.stop();
	}
}, 30_000);

test("a lone frame retains its border and title in whole-page and focused previews", async () => {
	const renderer = createCanvasPreviewRenderer();
	const snapshot = normalizeCanvasSnapshot({});
	const frameId = "shape:frame" as TLShapeId;
	snapshot.store[frameId] = {
		id: frameId,
		typeName: "shape",
		type: "frame",
		x: 0,
		y: 0,
		rotation: 0,
		index: "a1" as never,
		parentId: "page:page" as TLPageId,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: { w: 400, h: 200, name: "Must remain visible", color: "black" },
	};
	const before = JSON.stringify(snapshot);
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const wholePage = await renderer.render({ snapshot, command });
		const { next: withOtherShape } = drawing();
		withOtherShape.store[frameId] = snapshot.store[frameId];
		const focused = await renderer.render({
			snapshot: withOtherShape,
			command: { ...command, shapeIds: ["shape:frame"] },
		});
		for (const result of [wholePage, focused]) {
			expect(result.shapeIds).toEqual(["shape:frame"]);
			expect(result.bounds).toEqual({
				x: -32,
				y: -32,
				width: 464,
				height: 264,
			});
			const pixels = await page.evaluate(async (data) => {
				const image = new Image();
				image.src = `data:image/png;base64,${data}`;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const ctx = canvas.getContext("2d");
				if (!ctx) throw new Error("Cannot inspect PNG");
				ctx.drawImage(image, 0, 0);
				const countDarkPixels = (
					x: number,
					y: number,
					w: number,
					h: number,
				) => {
					const { data } = ctx.getImageData(x, y, w, h);
					let count = 0;
					for (let i = 0; i < data.length; i += 4)
						if (data[i] < 230 && data[i + 1] < 230 && data[i + 2] < 230)
							count++;
					return count;
				};
				return {
					title: countDarkPixels(32, 0, 400, 28),
					border: countDarkPixels(30, 40, 5, 180),
				};
			}, result.image.data);
			expect(pixels.title).toBeGreaterThan(20);
			expect(pixels.border).toBeGreaterThan(100);
		}
		expect(JSON.stringify(snapshot)).toBe(before);
	} finally {
		await browser.close();
		await renderer.stop();
	}
}, 30_000);

test("empty pages are explicit blank previews and large drawings fit within the resolution cap", async () => {
	const renderer = createCanvasPreviewRenderer();
	try {
		const empty = await renderer.render({
			snapshot: normalizeCanvasSnapshot({}),
			command,
		});
		expect(empty).toMatchObject({ width: 640, height: 360, shapeIds: [] });
		const { next } = prepareCanvasEdit(normalizeCanvasSnapshot({}), {
			action: "edit",
			canvasId: command.canvasId,
			expectedRevision: "test",
			operations: [
				{
					op: "create",
					ref: "wide",
					type: "rectangle",
					x: 0,
					y: 0,
					width: 10_000,
					height: 10_000,
				},
			],
		});
		const big = await renderer.render({ snapshot: next, command });
		expect(big.width).toBe(1600);
		expect(big.height).toBe(1600);
		expect(big.bounds.width).toBe(10_064);
		const wide = prepareCanvasEdit(normalizeCanvasSnapshot({}), {
			action: "edit",
			canvasId: command.canvasId,
			expectedRevision: "test",
			operations: [
				{ op: "create", ref: "left", type: "rectangle", x: -1_000_000, y: 0 },
				{ op: "create", ref: "right", type: "rectangle", x: 1_000_000, y: 0 },
			],
		});
		const panoramic = await renderer.render({ snapshot: wide.next, command });
		expect(panoramic.width).toBe(1600);
		expect(panoramic.height).toBe(1);
	} finally {
		await renderer.stop();
	}
}, 30_000);

test("page and shape selection is explicit, bounded and rejects unsupported descendants", () => {
	const { next: snapshot, createdShapes } = drawing();
	const records: Record<string, TLRecord> = snapshot.store;
	records["page:second"] = {
		id: "page:second" as never,
		typeName: "page",
		index: "a2" as never,
		name: "Second",
		meta: {},
	};
	expect(() => prepareCanvasPreview(snapshot, command)).toThrow(
		"Specify pageId",
	);
	expect(
		prepareCanvasPreview(snapshot, { ...command, pageId: "page:second" })
			.shapeIds,
	).toEqual([]);
	expect(() =>
		prepareCanvasPreview(snapshot, {
			...command,
			pageId: "page:second",
			shapeIds: [createdShapes.api],
		}),
	).toThrow("not on the selected");
	expect(() =>
		prepareCanvasPreview(snapshot, { ...command, pageId: "page:missing" }),
	).toThrow("does not exist");
	expect(
		PreviewCanvasInputSchema.safeParse({
			canvasId: command.canvasId,
			shapeIds: [],
		}).success,
	).toBeFalse();
	const shape = records[createdShapes.api];
	if (shape.typeName !== "shape") throw new Error("Expected a shape");
	records["shape:group"] = {
		...shape,
		id: "shape:group" as TLShapeId,
		type: "group",
		props: {},
	};
	shape.parentId = "shape:group" as TLShapeId;
	expect(
		prepareCanvasPreview(snapshot, {
			...command,
			pageId: "page:page",
			shapeIds: ["shape:group"],
		}).shapeIds,
	).toContain(shape.id);
	Object.assign(shape, { type: "image" });
	expect(() =>
		prepareCanvasPreview(snapshot, {
			...command,
			pageId: "page:page",
			shapeIds: ["shape:group"],
		}),
	).toThrow("do not support image");
	// An unrelated media shape does not prevent a focused native-shape preview.
	expect(
		prepareCanvasPreview(snapshot, {
			...command,
			pageId: "page:page",
			shapeIds: [createdShapes.db],
		}).shapeIds,
	).toEqual([createdShapes.db as TLShapeId]);
});

test("nested shapes use page coordinates and frame clipping does not expand the crop", async () => {
	const renderer = createCanvasPreviewRenderer();
	const { next: snapshot, createdShapes } = drawing();
	const records: Record<string, TLRecord> = snapshot.store;
	const child = records[createdShapes.api];
	if (child.typeName !== "shape") throw new Error("Expected shape");
	records["shape:frame"] = {
		...child,
		id: "shape:frame" as TLShapeId,
		x: 1000,
		y: 2000,
		type: "frame",
		props: { w: 500, h: 400, name: "Phase", color: "black" },
	};
	child.parentId = "shape:frame" as TLShapeId;
	child.x = 50;
	child.y = 50;
	try {
		const nested = await renderer.render({
			snapshot,
			command: { ...command, shapeIds: [child.id] },
		});
		expect(nested.bounds).toEqual({
			x: 1018,
			y: 2018,
			width: 304,
			height: 184,
		});
		child.x = 50_000;
		const frame = await renderer.render({
			snapshot,
			command: { ...command, shapeIds: ["shape:frame"] },
		});
		expect(frame.bounds).toEqual({ x: 968, y: 1968, width: 564, height: 464 });
		await expect(
			renderer.render({
				snapshot,
				command: { ...command, shapeIds: [child.id] },
			}),
		).rejects.toMatchObject({ code: "INVALID_CANVAS_PREVIEW" });
	} finally {
		await renderer.stop();
	}
}, 30_000);

test("oversized pages and cyclic shape hierarchies are rejected before opening a browser", () => {
	const { next: snapshot, createdShapes } = drawing();
	const records: Record<string, TLRecord> = snapshot.store;
	const shape = records[createdShapes.api];
	if (shape.typeName !== "shape") throw new Error("Expected shape");
	shape.parentId = shape.id;
	expect(() => prepareCanvasPreview(snapshot, command)).toThrow(
		"unsupported shape hierarchy",
	);
	shape.parentId = "page:page" as never;
	for (let i = 0; i < 1000; i++) {
		const id = `shape:extra-${i}` as TLShapeId;
		records[id] = { ...shape, id };
	}
	expect(() => prepareCanvasPreview(snapshot, command)).toThrow(
		"limited to 1000 shapes",
	);
});

test("renderer refuses overlapping work and stays unavailable after shutdown", async () => {
	const renderer = createCanvasPreviewRenderer();
	const input = { snapshot: normalizeCanvasSnapshot({}), command };
	try {
		const first = renderer.render(input);
		await expect(renderer.render(input)).rejects.toMatchObject({
			code: "CANVAS_PREVIEW_UNAVAILABLE",
		});
		await first;
	} finally {
		await renderer.stop();
	}
	await expect(renderer.render(input)).rejects.toMatchObject({
		code: "CANVAS_PREVIEW_UNAVAILABLE",
	});
}, 30_000);
