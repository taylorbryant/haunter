import { chmod, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
await rm(new URL("dist", root), { recursive: true, force: true });
const result = await Bun.build({
	entrypoints: [fileURLToPath(new URL("src/index.ts", root))],
	outdir: fileURLToPath(new URL("dist", root)),
	target: "node",
	format: "esm",
	packages: "external",
});
if (!result.success) throw new AggregateError(result.logs, "CLI build failed");
await chmod(new URL("dist/index.js", root), 0o755);
