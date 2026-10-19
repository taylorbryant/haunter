import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cliFixture,
	verifyFriendlyCommands,
} from "../features/agents/tests/cli-fixture";
import baseline from "../features/agents/tests/fixtures/cli-contract-0.1.0.json";

// Never resolve "latest" or rebuild the old client from candidate source.
const { version, integrity } = baseline.release;
const directory = await mkdtemp(join(tmpdir(), "haunter-published-cli-"));
const f = await cliFixture();
async function run(args: string[], input?: string) {
	const child = Bun.spawn(args, {
		cwd: directory,
		env: { ...process.env, ...f.env },
		stdin: input === undefined ? "ignore" : new Blob([input]),
		stdout: "pipe",
		stderr: "pipe",
		timeout: 120_000,
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, code };
}
try {
	const response = await fetch(
		`https://registry.npmjs.org/haunter/-/haunter-${version}.tgz`,
		{ signal: AbortSignal.timeout(30_000) },
	);
	assert.ok(
		response.ok,
		`Could not download haunter@${version}: ${response.status}`,
	);
	const bytes = Buffer.from(await response.arrayBuffer());
	assert.equal(
		`sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		integrity,
		"Published CLI tarball integrity mismatch",
	);
	const tarball = join(directory, `haunter-${version}.tgz`);
	await writeFile(tarball, bytes);
	const installed = await run([
		"npm",
		"install",
		"--prefix",
		directory,
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		"--no-package-lock",
		tarball,
	]);
	assert.equal(installed.code, 0, installed.stderr);
	const binary = join(directory, "node_modules", "haunter", "dist", "index.js");
	const reported = await run(["node", binary, "--version"]);
	assert.equal(reported.code, 0, reported.stderr);
	assert.equal(reported.stdout.trim(), version);
	await verifyFriendlyCommands(
		(args, stdin) => run(["node", binary, ...args], stdin),
		f.workspaceId,
	);
	console.log(
		`Verified published haunter@${version} against the current MCP handler: workspace selection, page creation/search/read/append, child pages, tasks, and access denial.`,
	);
} finally {
	await f.close();
	await rm(directory, { recursive: true, force: true });
}
