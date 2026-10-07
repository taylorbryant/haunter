import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { getAssetUrls } from "@tldraw/assets/selfHosted";
import {
	createCanvasPreviewContext,
	type PreviewFiles,
} from "./preview-context";
export const canvasBrowserOrigin = "http://localhost";
let assetsPromise: Promise<PreviewFiles> | undefined;
function assets() {
	if (assetsPromise) return assetsPromise;
	assetsPromise = (async () => {
		const bundle = await Bun.build({
			entrypoints: [join(import.meta.dir, "canvas-browser.ts")],
			target: "browser",
			minify: true,
			define: { "process.env.NODE_ENV": '"production"' },
		});
		if (!bundle.success)
			throw new Error("Could not build canvas browser runtime.");
		const files: PreviewFiles = new Map();
		files.set(`${canvasBrowserOrigin}/`, {
			contentType: "text/html",
			body: '<!doctype html><html><head><link rel="stylesheet" href="/tldraw.css"></head><body><script type="module" src="/preview.js"></script></body></html>',
		});
		files.set(`${canvasBrowserOrigin}/preview.js`, {
			contentType: "text/javascript",
			body: await bundle.outputs[0].text(),
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

/** A bounded, network-denied browser; document URLs can never fetch external assets. */
export function createCanvasBrowserRunner() {
	let busy = false;
	let stopped = false;
	let browser: Browser | undefined;
	return {
		get available() {
			return !busy && !stopped;
		},
		async run<T>(execute: (page: Page) => Promise<T>): Promise<T> {
			if (busy || stopped) throw new Error("Canvas browser is unavailable.");
			busy = true;
			let cancelled = false;
			let activeBrowser: Browser | undefined;
			let deadline: ReturnType<typeof setTimeout> | undefined;
			try {
				// Include bundling and browser startup in the deadline, below the 30s bridge limit.
				return await Promise.race([
					(async () => {
						const files = await assets();
						if (stopped || cancelled) throw new Error("Canvas browser stopped");
						const launched = await chromium.launch({
							headless: true,
							timeout: 8000,
						});
						activeBrowser = launched;
						if (stopped || cancelled) {
							await launched.close();
							throw new Error("Canvas browser stopped");
						}
						browser = launched;
						const context = await createCanvasPreviewContext(launched, files);
						const page = await context.newPage();
						await page.goto(canvasBrowserOrigin, {
							timeout: 5000,
							waitUntil: "load",
						});
						return execute(page);
					})(),
					new Promise<never>((_, reject) => {
						deadline = setTimeout(
							() => reject(new Error("Canvas browser timed out")),
							20_000,
						);
					}),
				]);
			} finally {
				cancelled = true;
				clearTimeout(deadline);
				await activeBrowser?.close().catch(() => {});
				if (browser === activeBrowser) browser = undefined;
				busy = false;
			}
		},
		async stop() {
			stopped = true;
			await browser?.close();
		},
	};
}
