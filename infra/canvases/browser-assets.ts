import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAssetUrls } from "@tldraw/assets/selfHosted";
import type { PreviewFiles } from "./preview-context";
export const canvasBrowserOrigin = "http://localhost";
let assetsPromise: Promise<PreviewFiles> | undefined;
export function canvasBrowserAssets() {
	if (assetsPromise) return assetsPromise;
	assetsPromise = (async () => {
		const built = Bun.file(
			join(import.meta.dir, "../../.canvas-runtime/preview.js"),
		);
		let javascript: string;
		if (process.env.NODE_ENV === "production") {
			if (!(await built.exists()))
				throw new Error(
					"Build the canvas browser runtime before starting the worker.",
				);
			javascript = await built.text();
		} else {
			// Development/tests must reflect source edits, even after a local build.
			const bundle = await Bun.build({
				entrypoints: [join(import.meta.dir, "canvas-browser.ts")],
				target: "browser",
				minify: true,
				define: { "process.env.NODE_ENV": '"production"' },
			});
			if (!bundle.success)
				throw new Error("Could not build canvas browser runtime.");
			javascript = await bundle.outputs[0].text();
		}
		const files: PreviewFiles = new Map();
		files.set(`${canvasBrowserOrigin}/`, {
			contentType: "text/html",
			body: '<!doctype html><html><head><link rel="stylesheet" href="/tldraw.css"></head><body><script type="module" src="/preview.js"></script></body></html>',
		});
		files.set(`${canvasBrowserOrigin}/preview.js`, {
			contentType: "text/javascript",
			body: javascript,
		});
		files.set(`${canvasBrowserOrigin}/tldraw.css`, {
			contentType: "text/css",
			body: await Bun.file(
				fileURLToPath(import.meta.resolve("tldraw/tldraw.css")),
			).text(),
		});
		const assetRoot = dirname(
			fileURLToPath(import.meta.resolve("@tldraw/assets/selfHosted.js")),
		);
		for (const url of Object.values(
			getAssetUrls({ baseUrl: canvasBrowserOrigin }).fonts,
		)) {
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
