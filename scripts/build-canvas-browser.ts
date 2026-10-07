import { join } from "node:path";

const result = await Bun.build({
	entrypoints: [join(import.meta.dir, "../infra/canvases/canvas-browser.ts")],
	outdir: join(import.meta.dir, "../.canvas-runtime"),
	naming: "preview.js",
	target: "browser",
	minify: true,
	define: { "process.env.NODE_ENV": '"production"' },
});
if (!result.success)
	throw new AggregateError(result.logs, "Canvas browser build failed");
console.info("Built canvas browser runtime");
