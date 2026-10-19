import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@/packages/cli/src/cli";
import { connect } from "@/packages/cli/src/client";
import { ProfileStore } from "@/packages/cli/src/config";
import { createRemoteMcpRequestHandler } from "@/server/remote-mcp";
import { embeddedEditorFixture } from "./embedded-editor-fixture";

export type CliRunner = (
	args: string[],
	stdin?: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

// Exercise the production MCP handler and use cases with disposable SQLite data.
// Authentication is supplied at the handler boundary; OAuth has separate tests.
export async function cliFixture(profile: "view" | "edit" = "edit") {
	const f = await embeddedEditorFixture(profile, profile);
	f.ctx.ports.workspaceEventStreamLeases = {
		isConfigured: () => false,
		acquire: async () => null,
	};
	const directory = await mkdtemp(join(tmpdir(), "haunter-cli-contract-"));
	const token = crypto.randomUUID();
	const handler = createRemoteMcpRequestHandler({
		connection: f.connection,
		identity: { userId: f.userId, clientId: f.connection.clientId },
		getServer: async () => ({
			ports: f.ctx.ports,
			createServiceContext: async () => f.ctx,
		}),
	});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) =>
			request.headers.get("authorization") === `Bearer ${token}`
				? handler(request)
				: new Response("Unauthorized", { status: 401 }),
	});
	const store = new ProfileStore(directory, new URL("/mcp", server.url).href);
	const saved = await store.load();
	saved.tokens = {
		access_token: token,
		token_type: "Bearer",
		expires_in: 3600,
	};
	await store.save(saved);
	const env = {
		HAUNTER_CONFIG_DIR: directory,
		HAUNTER_SERVER: store.server,
		HAUNTER_WORKSPACE: "",
	};
	const run: CliRunner = async (args, stdin = "") => {
		let stdout = "",
			stderr = "";
		const code = await runCli(args, {
			env,
			stdout: (text) => {
				stdout += text;
			},
			stderr: (text) => {
				stderr += text;
			},
			stdin: (async function* () {
				yield stdin;
			})(),
			isTTY: !stdin,
			signal: AbortSignal.timeout(15_000),
		});
		return { code, stdout, stderr };
	};
	return {
		...f,
		env,
		run,
		async tools() {
			const client = await connect(store, await store.load());
			try {
				return await client.listTools();
			} finally {
				await client.close();
			}
		},
		async close() {
			await server.stop(true);
			await f.database.close();
			await rm(directory, { recursive: true, force: true });
		},
	};
}

// Shared by the current source CLI and the exact published Node executable.
export async function verifyFriendlyCommands(
	run: CliRunner,
	workspaceId: string,
) {
	async function json(args: string[], input?: string) {
		const result = await run([...args, "--json"], input);
		assert.equal(result.code, 0, `${args.join(" ")}: ${result.stderr}`);
		return JSON.parse(result.stdout);
	}
	const workspaces = await json(["workspaces", "list"]);
	assert.ok(
		workspaces.workspaces.some((w: { id: string }) => w.id === workspaceId),
	);
	await json(["workspaces", "use", workspaceId]);
	const page = await json(
		["capture", "--title", "CLI compatibility"],
		"Original content.",
	);
	assert.equal(page.title, "CLI compatibility");
	const pages = await json(["pages", "list"]);
	assert.ok(
		pages.pages.some((p: { pageId: string }) => p.pageId === page.pageId),
	);
	const search = await json(["pages", "search", "CLI compatibility"]);
	assert.ok(
		search.pages.some((p: { pageId: string }) => p.pageId === page.pageId),
	);
	await json(["capture", "Appended content.", "--page", page.pageId]);
	const read = await json(["pages", "read", page.pageId]);
	assert.match(read.markdown, /Original content/);
	assert.match(read.markdown, /Appended content/);
	const child = await json([
		"capture",
		"Child content",
		"--parent",
		page.pageId,
		"--title",
		"Child",
	]);
	assert.equal(child.parentPageId, page.pageId);
	const task = await json(["tasks", "add", "CLI task", "--due", "2026-12-12"]);
	assert.equal(task.title, "CLI task");
	assert.equal(task.dueDate, "2026-12-12");
	const tasks = await json([
		"tasks",
		"list",
		"--filter",
		"open",
		"--scope",
		"everyone",
		"--limit",
		"10",
	]);
	assert.ok(
		tasks.tasks.some((t: { taskId: string }) => t.taskId === task.taskId),
	);
	assert.equal((await json(["tasks", "done", task.taskId])).completed, true);
	assert.ok(
		(await json(["tasks", "list", "--filter", "completed"])).tasks.some(
			(t: { taskId: string }) => t.taskId === task.taskId,
		),
	);
	const denied = await run([
		"capture",
		"Forbidden",
		"--workspace",
		"another-workspace",
		"--json",
	]);
	assert.equal(denied.code, 1);
	assert.equal(denied.stdout, "");
	assert.ok(JSON.parse(denied.stderr).error);
}
