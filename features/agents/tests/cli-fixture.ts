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

// Added in 0.2.0; shared with its published executable to catch semantic drift.
export async function verifyExtendedCommands(
	run: CliRunner,
	f: Awaited<ReturnType<typeof cliFixture>>,
) {
	async function json(args: string[], input?: string) {
		const result = await run([...args, "--json"], input);
		assert.equal(result.stderr, "");
		assert.equal(result.code, 0, args.join(" "));
		return JSON.parse(result.stdout);
	}
	const page = await json(["capture", "Original body", "--title", "CLI notes"]);
	const renamed = await json([
		"pages",
		"rename",
		page.pageId,
		"CLI renamed notes",
	]);
	assertFields(renamed, {
		pageId: page.pageId,
		title: "CLI renamed notes",
		parentPageId: null,
	});
	assert.match(
		(await json(["pages", "read", page.pageId])).markdown,
		/Original body/,
	);
	const canvas = await f.database.repositories.canvases.create(f.scope, {
		userId: f.userId,
		pageId: null,
		title: "CLI drawing",
	});
	const inline = await f.database.repositories.canvases.create(f.scope, {
		userId: f.userId,
		pageId: page.pageId,
		title: "Inline drawing",
	});
	const canvases = await json(["canvases", "list"]);
	assert.ok(
		canvases.canvases.some(
			(item: { canvasId: string; title: string }) =>
				item.canvasId === canvas.id && item.title === "CLI drawing",
		),
	);
	assert.ok(
		!canvases.canvases.some(
			(item: { canvasId: string }) => item.canvasId === inline.id,
		),
	);
	const created = await json(
		["tools", "call", "create_task", "--input", "-"],
		JSON.stringify({
			title: "CLI task",
			dueDate: "2026-12-12",
			dueTime: "09:30",
			reminderOffsetMinutes: 15,
		}),
	);
	const taskId = created.structuredContent.taskId;
	const updated = await json([
		"tasks",
		"update",
		taskId,
		"--title",
		"CLI renamed task",
		"--due",
		"2026-12-13",
	]);
	assertFields(updated, {
		title: "CLI renamed task",
		dueDate: "2026-12-13",
		dueTime: "09:30",
		reminderOffsetMinutes: 15,
		completed: false,
	});
	await json(["tasks", "done", taskId]);
	assertFields(await json(["tasks", "reopen", taskId]), {
		taskId,
		completed: false,
		completedAt: null,
	});
	assertFields(await json(["tasks", "update", taskId, "--clear-due"]), {
		title: "CLI renamed task",
		dueDate: null,
		dueTime: null,
		reminderOffsetMinutes: null,
	});
	const items: { kind: string; id: string }[] = [];
	let cursor: string | null = null;
	for (let count = 0; count < 10; count++) {
		const result = await json([
			"search",
			"CLI",
			"--limit",
			"1",
			...(cursor ? ["--cursor", cursor] : []),
		]);
		items.push(...result.items);
		cursor = result.nextCursor;
		if (cursor === null) break;
	}
	assert.equal(cursor, null);
	assert.equal(items.length, 3);
	for (const [kind, id] of [
		["page", page.pageId],
		["task", taskId],
		["canvas", canvas.id],
	]) {
		assert.ok(
			items.some((item) => item.kind === kind && item.id === id),
			`Missing ${kind} search result`,
		);
	}
	const filtered = await json(["search", "CLI", "--kind", "canvas"]);
	assert.equal(filtered.items.length, 1);
	assert.equal(filtered.items[0].id, canvas.id);
}

export async function verifyViewOnlyMutations(
	run: CliRunner,
	page: { id: string; title: string },
) {
	for (const args of [
		["pages", "rename", page.id, "Forbidden rename"],
		["tasks", "update", crypto.randomUUID(), "--clear-due"],
		["tasks", "reopen", crypto.randomUUID()],
	]) {
		const denied = await run([...args, "--json"]);
		assert.equal(denied.code, 1, args.join(" "));
		assert.equal(denied.stdout, "");
	}
	const read = await run(["pages", "read", page.id, "--json"]);
	assert.equal(read.code, 0, read.stderr);
	assert.equal(JSON.parse(read.stdout).title, page.title);
}

export async function verifyToolDiscovery(run: CliRunner, pageId: string) {
	const listed = await run(["tools", "list", "--json"]);
	assert.equal(listed.code, 0, listed.stderr);
	const tools = JSON.parse(listed.stdout).tools as { name: string }[];
	assert.ok(tools.some((tool) => tool.name === "read_page"));
	assert.ok(!tools.some((tool) => tool.name === "create_page"));
	assert.ok(!tools.some((tool) => tool.name === "authorize_haunter_editor"));
	const described = await run(["tools", "describe", "read_page", "--json"]);
	assert.equal(described.code, 0, described.stderr);
	assert.deepEqual(
		JSON.parse(described.stdout),
		tools.find((tool) => tool.name === "read_page"),
	);
	const called = await run(["tools", "call", "list_pages", "--json"]);
	assert.equal(called.code, 0, called.stderr);
	assert.ok(
		JSON.parse(called.stdout).structuredContent.pages.some(
			(page: { pageId: string }) => page.pageId === pageId,
		),
	);
	const invalid = await run(
		["tools", "call", "read_page", "--input", "-", "--json"],
		'{"pageId":"not-a-uuid"}',
	);
	assert.equal(invalid.code, 1);
	assert.match(JSON.parse(invalid.stderr).error, /Invalid arguments/);
	const denied = await run(["tools", "call", "create_page", "--json"]);
	assert.equal(denied.code, 1);
	assert.match(JSON.parse(denied.stderr).error, /not available/);
}

function assertFields(
	actual: Record<string, unknown>,
	expected: Record<string, unknown>,
) {
	for (const [key, value] of Object.entries(expected)) {
		assert.deepEqual(actual[key], value, key);
	}
}
