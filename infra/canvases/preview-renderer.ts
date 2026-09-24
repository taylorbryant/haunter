import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
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
	createCanvasPreviewContext,
	type PreviewFiles,
} from "./preview-context";

const origin = "http://localhost";
let assetsPromise: Promise<PreviewFiles> | undefined;
function assets() {
	if (assetsPromise) return assetsPromise;
	assetsPromise = (async () => {
		const bundle = await Bun.build({
			entrypoints: [join(import.meta.dir, "preview-browser.ts")],
			target: "browser",
			minify: true,
			define: { "process.env.NODE_ENV": '"production"' },
		});
		if (!bundle.success)
			throw new Error("Could not build canvas preview renderer.");
		const files: PreviewFiles = new Map();
		files.set(`${origin}/`, {
			contentType: "text/html",
			body: '<!doctype html><html><head><link rel="stylesheet" href="/tldraw.css"></head><body><script type="module" src="/preview.js"></script></body></html>',
		});
		files.set(`${origin}/preview.js`, {
			contentType: "text/javascript",
			body: await bundle.outputs[0].text(),
		});
		files.set(`${origin}/tldraw.css`, {
			contentType: "text/css",
			body: await Bun.file(
				fileURLToPath(import.meta.resolve("tldraw/tldraw.css")),
			).text(),
		});
		const assetRoot = dirname(
			fileURLToPath(import.meta.resolve("@tldraw/assets/selfHosted.js")),
		);
		for (const url of Object.values(getAssetUrls({ baseUrl: origin }).fonts)) {
			const path = new URL(url).pathname;
			files.set(url, {
				contentType: "font/woff2",
				body: Buffer.from(await Bun.file(join(assetRoot, path)).arrayBuffer()),
			});
		}
		return files;
	})().catch((error) => {
		assetsPromise = undefined;
		throw error;
	});
	return assetsPromise;
}

/** One isolated, network-denied browser per render, with a single worker-wide slot. */
export function createCanvasPreviewRenderer(
	options: { licenseKey?: string } = {},
): CanvasPreviewRenderer & { stop(): Promise<void> } {
	let busy = false;
	let stopped = false;
	let browser: Browser | undefined;
	return {
		async render(input) {
			if (busy || stopped) throw appError("CanvasPreviewUnavailable");
			const selected = prepareCanvasPreview(input.snapshot, input.command);
			busy = true;
			let deadline: ReturnType<typeof setTimeout> | undefined;
			try {
				const files = await assets();
				if (stopped) throw new Error("Renderer stopped");
				browser = await chromium.launch({ headless: true, timeout: 8000 });
				if (stopped) throw new Error("Renderer stopped");
				const activeBrowser = browser;
				return await Promise.race([
					(async () => {
						const context = await createCanvasPreviewContext(
							activeBrowser,
							files,
						);
						const page = await context.newPage();
						await page.goto(origin, { timeout: 5000, waitUntil: "load" });
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
								fontAssetUrls: getAssetUrls({ baseUrl: origin }).fonts,
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
					})(),
					new Promise<never>((_, reject) => {
						deadline = setTimeout(
							() => reject(new Error("Canvas preview timed out")),
							15_000,
						);
					}),
				]);
			} catch (error) {
				if (isAppError(error)) throw error;
				console.error("Canvas preview renderer failed", error);
				throw appError("CanvasPreviewUnavailable");
			} finally {
				clearTimeout(deadline);
				await browser?.close().catch(() => {});
				browser = undefined;
				busy = false;
			}
		},
		async stop() {
			stopped = true;
			await browser?.close();
		},
	};
}
