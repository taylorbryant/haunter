import { readCanvasImage } from "./image-edits";
import { isAppError } from "@beignet/core/errors";
import { getAssetUrls } from "@tldraw/assets/selfHosted";
import type { CanvasPreviewRenderer } from "@/features/canvases/ports";
import { CanvasPreviewOutputSchema } from "@/features/canvases/editing";
import { appError } from "@/features/shared/errors";
import type {
	BrowserPreviewInput,
	renderCanvasPreview,
} from "./preview-browser";
import { prepareCanvasPreview } from "./preview-selection";
import {
	createCanvasBrowserRunner,
	canvasBrowserOrigin,
	type CanvasBrowserRunner,
} from "./browser-runtime";

export function createCanvasPreviewRenderer(
	options: { licenseKey?: string; runner?: CanvasBrowserRunner } = {},
): CanvasPreviewRenderer & { stop(): Promise<void> } {
	const runner = options.runner ?? createCanvasBrowserRunner();
	return {
		async render(input) {
			try {
				return await runner.run("preview", async (job) => {
					job.signal.throwIfAborted();
					const selected = prepareCanvasPreview(input.snapshot, input.command);
					const processed = new Set<string>();
					const started = performance.now();
					let pixels = 0,
						bytes = 0;
					for (const id of selected.shapeIds) {
						job.signal.throwIfAborted();
						const shape = selected.snapshot.store[id];
						if (shape?.typeName !== "shape" || shape.type !== "image") continue;
						if (shape.props.assetId && processed.has(shape.props.assetId))
							continue;
						if (processed.size >= 20 || performance.now() - started > 5_000)
							throw appError("InvalidCanvasPreview", {
								message: "Select fewer images for this preview (at most 20).",
							});
						const image = await readCanvasImage(selected.snapshot, id);
						job.signal.throwIfAborted();
						pixels += image.width * image.height;
						bytes += image.data.length;
						if (pixels > 16_000_000 || bytes > 4_000_000)
							throw appError("InvalidCanvasPreview", {
								message:
									"Select fewer images: previews support 16 megapixels and 4 MB of encoded image data in total.",
							});
						const asset =
							shape.props.assetId &&
							selected.snapshot.store[shape.props.assetId];
						if (asset && asset.typeName === "asset" && asset.type === "image") {
							processed.add(asset.id);
							asset.props = {
								...asset.props,
								src: `data:image/png;base64,${image.data}`,
								mimeType: "image/png",
								w: image.width,
								h: image.height,
								isAnimated: false,
							};
						}
					}
					const page = await job.page();
					const result = await page.evaluate(
						(serialized: string) =>
							(
								window as unknown as {
									renderCanvasPreview: typeof renderCanvasPreview;
								}
							).renderCanvasPreview(
								JSON.parse(serialized) as BrowserPreviewInput,
							),
						JSON.stringify({
							...selected,
							fontAssetUrls: getAssetUrls({ baseUrl: canvasBrowserOrigin })
								.fonts,
							licenseKey: options.licenseKey,
						}),
					);
					if (result.error)
						throw appError("InvalidCanvasPreview", { message: result.error });
					if (
						typeof result.url !== "string" ||
						!result.url.startsWith("data:image/png;base64,")
					)
						throw new Error("Expected a PNG preview");
					const data = result.url.slice("data:image/png;base64,".length);
					const png = Buffer.from(data, "base64");
					if (
						png.length < 24 ||
						png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
						png.toString("ascii", 12, 16) !== "IHDR"
					)
						throw new Error("Expected a PNG header");
					// tldraw reports logical dimensions, which can be fractional. The
					// PNG's IHDR contains the actual integer bitmap dimensions.
					return CanvasPreviewOutputSchema.omit({
						canvasId: true,
						revision: true,
					}).parse({
						pageId: selected.pageId,
						shapeIds: selected.shapeIds,
						bounds: result.bounds,
						width: png.readUInt32BE(16),
						height: png.readUInt32BE(20),
						image: {
							mimeType: "image/png",
							data,
						},
					});
				});
			} catch (error) {
				if (isAppError(error)) {
					if (error.code === "INVALID_CANVAS_EDIT")
						throw appError("InvalidCanvasPreview", { message: error.message });
					throw error;
				}
				// The shared runner emits bounded metrics without logging drawing content.
				throw appError("CanvasPreviewUnavailable");
			}
		},
		stop: options.runner ? async () => {} : runner.stop,
	};
}
