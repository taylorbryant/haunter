import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "../package.json";
import { fixture, PAGE_ID } from "../tests/helpers";

// Exercise the packed, installed binary under Node, with no Bun runtime dependency.
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "haunter-package-"));
const f = await fixture();
async function run(command: string[], cwd = directory, input?: string) {
	const child = Bun.spawn(command, {
		cwd,
		env: {
			...process.env,
			HAUNTER_CONFIG_DIR: f.directory,
			HAUNTER_SERVER: f.store.server,
			HAUNTER_WORKSPACE: "workspace-1",
		},
		stdin: input === undefined ? "ignore" : new Blob([input]),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	assert.equal(code, 0, `${command.join(" ")} failed:\n${stderr}`);
	return stdout;
}
try {
	const packed = JSON.parse(
		await run(
			[
				"npm",
				"pack",
				"--ignore-scripts",
				"--json",
				"--pack-destination",
				directory,
			],
			root,
		),
	);
	const files = packed[0].files
		.map((file: { path: string }) => file.path)
		.sort();
	assert.deepEqual(files, [
		"LICENSE",
		"README.md",
		"dist/index.js",
		"package.json",
	]);
	assert.equal(packed[0].name, "haunter");
	await run([
		"npm",
		"install",
		"--prefix",
		directory,
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		"--no-package-lock",
		join(directory, packed[0].filename),
	]);
	const bin = join(directory, "node_modules", "haunter", "dist", "index.js");
	assert.ok((await readFile(bin, "utf8")).startsWith("#!/usr/bin/env node"));
	assert.equal((await run(["node", bin, "--version"])).trim(), version);
	assert.ok((await run(["node", bin, "--help"])).includes("capture"));
	await f.signIn();
	f.expire();
	const pages = JSON.parse(await run(["node", bin, "pages", "list", "--json"]));
	assert.equal(pages.pages[0].pageId, PAGE_ID);
	assert.equal(f.refreshes, 1);
	const page = JSON.parse(
		await run(
			["node", bin, "capture", "--title", "Package smoke test", "--json"],
			directory,
			"Hello from stdin.",
		),
	);
	assert.equal(page.pageId, PAGE_ID);
	assert.equal(f.calls.at(-1)?.arguments.markdown, "Hello from stdin.");
	console.log(
		`Verified haunter@${version}: npm tarball, Node binary, token refresh, page listing, and piped capture.`,
	);
} finally {
	await f.close();
	await rm(directory, { recursive: true, force: true });
}
