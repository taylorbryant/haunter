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
} from "./browser-runtime";

export function createCanvasPreviewRenderer(
	options: { licenseKey?: string } = {},
): CanvasPreviewRenderer & { stop(): Promise<void> } {
	const runner = createCanvasBrowserRunner();
	return {
		async render(input) {
			if (!runner.available) throw appError("CanvasPreviewUnavailable");
			const selected = prepareCanvasPreview(input.snapshot, input.command);
			try {
				return await runner.run(async (page) => {
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
				if (isAppError(error)) throw error;
				console.error("Canvas preview renderer failed", error);
				throw appError("CanvasPreviewUnavailable");
			}
		},
		stop: runner.stop,
	};
}
