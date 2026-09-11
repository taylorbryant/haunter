import {
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const routes = [
	"api/auth/[...all]/route.js",
	"api/[[...path]]/route.js",
	"(app)/w/[workspaceId]/p/[pageId]/page.js",
];

// A full node_modules hides missing deployment files. Reconstruct each route
// strictly from Next's trace, outside the checkout, and load its external alias
// with the same Bun runtime used by our Vercel functions.
for (const route of routes) {
	const tracePath = join(projectRoot, ".next/server/app", `${route}.nft.json`);
	const trace: { files: string[] } = await Bun.file(tracePath).json();
	const files = trace.files.map((file) => resolve(dirname(tracePath), file));
	const yjsAlias = files.find((file) =>
		/[/\\]\.next[/\\]node_modules[/\\]yjs-[a-f0-9]+$/.test(file),
	);
	if (!yjsAlias) throw new Error(`Missing external Yjs alias in ${route}`);

	const bundleRoot = mkdtempSync(join(tmpdir(), "haunter-yjs-bundle-"));
	try {
		for (const source of files) {
			const path = relative(projectRoot, source);
			if (path.startsWith("..") || isAbsolute(path)) {
				throw new Error(`Trace escapes the project: ${source}`);
			}
			const destination = join(bundleRoot, path);
			mkdirSync(dirname(destination), { recursive: true });
			if (lstatSync(source).isSymbolicLink()) {
				const target = resolve(dirname(source), readlinkSync(source));
				const targetPath = relative(projectRoot, target);
				if (targetPath.startsWith("..") || isAbsolute(targetPath)) {
					throw new Error(`External alias escapes the project: ${source}`);
				}
				symlinkSync(
					relative(dirname(destination), join(bundleRoot, targetPath)),
					destination,
				);
			} else {
				copyFileSync(source, destination);
			}
		}

		const alias = relative(join(projectRoot, ".next/node_modules"), yjsAlias);
		const probe = join(bundleRoot, ".next/probe.mjs");
		await Bun.write(
			probe,
			`import * as Y from ${JSON.stringify(alias)};
const source = new Y.Doc();
const restored = new Y.Doc();
source.getText("body").insert(0, "Persisted edit");
Y.applyUpdate(restored, Y.encodeStateAsUpdate(source));
if (restored.getText("body").toString() !== "Persisted edit") {
  throw new Error("Packaged Yjs update did not round-trip");
}
source.destroy();
restored.destroy();
`,
		);
		const result = Bun.spawnSync([process.execPath, probe], {
			cwd: bundleRoot,
			env: { ...process.env, NODE_PATH: undefined },
		});
		if (result.exitCode !== 0) {
			throw new Error(`Packaged Yjs failed for ${route}:\n${result.stderr}`);
		}
		console.log(`Packaged Yjs passed: ${route}`);
	} finally {
		rmSync(bundleRoot, { recursive: true, force: true });
	}
}
