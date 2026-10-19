import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliBaselines } from "../features/agents/tests/cli-baselines";
import {
	cliFixture,
	type CliRunner,
	verifyFriendlyCommands,
	verifyExtendedCommands,
	verifyViewOnlyMutations,
	verifyToolDiscovery,
} from "../features/agents/tests/cli-fixture";

// Never resolve "latest" or rebuild an old client from candidate source.
for (const baseline of cliBaselines) {
	const { version, integrity } = baseline.release;
	const directory = await mkdtemp(
		join(tmpdir(), `haunter-published-cli-${version}-`),
	);
	async function run(
		args: string[],
		input?: string,
		env: Record<string, string> = {},
	) {
		const child = Bun.spawn(args, {
			cwd: directory,
			env: { ...process.env, ...env },
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
	const binary = join(directory, "node_modules", "haunter", "dist", "index.js");
	async function verify(
		profile: "view" | "edit",
		check: (
			run: CliRunner,
			fixture: Awaited<ReturnType<typeof cliFixture>>,
		) => Promise<void>,
	) {
		const f = await cliFixture(profile);
		try {
			await check(
				(args, stdin) => run(["node", binary, ...args], stdin, f.env),
				f,
			);
		} finally {
			await f.close();
		}
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
			`Published haunter@${version} tarball integrity mismatch`,
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
		const reported = await run(["node", binary, "--version"]);
		assert.equal(reported.code, 0, reported.stderr);
		assert.equal(reported.stdout.trim(), version);
		await verify("edit", (run, f) =>
			verifyFriendlyCommands(run, f.workspaceId),
		);
		if (version === "0.2.0") {
			await verify("edit", verifyExtendedCommands);
			await verify("view", async (run, f) => {
				await verifyViewOnlyMutations(run, f.page);
				await verifyToolDiscovery(run, f.page.id);
			});
		}
		console.log(
			`Verified published haunter@${version} against the current MCP handler: workspace selection, page creation/search/read/append, child pages, tasks, and access denial${version === "0.2.0" ? "; workspace search/pagination, canvases, page rename, task update/reopen, tool discovery/validation, and view-only permissions" : ""}.`,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
