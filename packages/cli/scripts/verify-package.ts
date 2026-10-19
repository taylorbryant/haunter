import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "../package.json";
import { fixture, PAGE_ID, TASK_ID, CANVAS_ID } from "../tests/helpers";

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
	assert.equal(
		JSON.parse(await run(["node", bin, "search", "meeting", "--json"])).items[0]
			.id,
		PAGE_ID,
	);
	assert.equal(
		JSON.parse(await run(["node", bin, "canvases", "list", "--json"]))
			.canvases[0].canvasId,
		CANVAS_ID,
	);
	assert.equal(
		JSON.parse(
			await run(["node", bin, "pages", "rename", PAGE_ID, "Renamed", "--json"]),
		).title,
		"Renamed",
	);
	assert.equal(
		JSON.parse(
			await run([
				"node",
				bin,
				"tasks",
				"update",
				TASK_ID,
				"--due",
				"2026-12-12",
				"--json",
			]),
		).dueDate,
		"2026-12-12",
	);
	assert.equal(
		JSON.parse(await run(["node", bin, "tasks", "reopen", TASK_ID, "--json"]))
			.completed,
		false,
	);
	f.setToolPages([
		{
			tools: [
				{
					name: "package_tool",
					inputSchema: {
						type: "object",
						properties: { count: { type: "integer" } },
						required: ["count"],
					},
				},
			],
		},
	]);
	f.setToolResult("package_tool", {
		content: [{ type: "text", text: "OK" }],
		structuredContent: { ok: true },
	});
	const tools = JSON.parse(await run(["node", bin, "tools", "list", "--json"]));
	assert.equal(tools.tools[0].name, "package_tool");
	const called = JSON.parse(
		await run(
			["node", bin, "tools", "call", "package_tool", "--input", "-", "--json"],
			directory,
			'{"count":1}',
		),
	);
	assert.deepEqual(called.structuredContent, { ok: true });
	assert.deepEqual(f.calls.at(-1)?.arguments, { count: 1 });
	console.log(
		`Verified haunter@${version}: npm tarball, Node binary, token refresh, page listing, piped capture, search, canvases, page/task updates, and dynamic tools.`,
	);
} finally {
	await f.close();
	await rm(directory, { recursive: true, force: true });
}
