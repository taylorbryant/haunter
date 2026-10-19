import { afterEach, expect, test } from "bun:test";
import { fixture, PAGE_ID, TASK_ID, CANVAS_ID } from "./helpers";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of disposers.splice(0)) await close();
});
async function setup() {
	const f = await fixture();
	disposers.push(f.close);
	await f.signIn();
	return f;
}

test("workspace search shows mixed results, preserves metadata, and supports continuing a filtered search", async () => {
	const f = await setup();
	const result = {
		items: [
			{
				kind: "page",
				id: PAGE_ID,
				title: "Notes\u001b[31m",
				snippet: "First\nline",
				path: "/pages/test",
			},
			{
				kind: "task",
				id: TASK_ID,
				title: "Review",
				snippet: "",
				completed: false,
			},
			{
				kind: "canvas",
				id: CANVAS_ID,
				title: "Drawing",
				snippet: "Architecture",
			},
		],
		nextCursor: "next-page",
	};
	f.setToolResult("search_workspace", {
		content: [],
		structuredContent: result,
	});
	const plain = await f.run(["search", " meeting notes "]);
	expect(plain.code).toBe(0);
	expect(plain.stdout).toContain(`page\t${PAGE_ID}\tNotes\n  First line`);
	expect(plain.stdout).toContain(`task\t${TASK_ID}`);
	expect(plain.stdout).toContain(`canvas\t${CANVAS_ID}`);
	expect(plain.stdout).not.toContain("\u001b");
	expect(plain.stderr).toContain("--cursor");
	expect(plain.stderr).toContain("next-page");
	expect(f.calls.at(-1)).toEqual({
		name: "search_workspace",
		arguments: {
			workspaceId: "workspace-1",
			query: "meeting notes",
			kind: "all",
			limit: 20,
		},
	});
	const json = await f.run([
		"search",
		"meeting notes",
		"--kind",
		"page",
		"--limit",
		"50",
		"--cursor",
		"next-page",
		"-w",
		"team",
		"--json",
	]);
	expect(json).toMatchObject({ code: 0, stderr: "" });
	expect(JSON.parse(json.stdout)).toEqual(result);
	expect(f.calls.at(-1)?.arguments).toEqual({
		workspaceId: "team",
		query: "meeting notes",
		kind: "page",
		limit: 50,
		cursor: "next-page",
	});
	f.setToolResult("search_workspace", {
		content: [],
		structuredContent: { items: [], nextCursor: null },
	});
	expect(await f.run(["search", "absent"])).toMatchObject({
		code: 0,
		stdout: "No results found.\n",
		stderr: "",
	});
});

test("canvas listing uses workspace selection, clean titles, and retains JSON metadata", async () => {
	const f = await setup();
	const plain = await f.run(["canvases", "list", "-w", "team"]);
	expect(plain).toMatchObject({ code: 0, stdout: `${CANVAS_ID}\tDrawing\n` });
	expect(f.calls.at(-1)).toEqual({
		name: "list_canvases",
		arguments: { workspaceId: "team" },
	});
	const json = await f.run(["canvases", "list", "--json"]);
	expect(JSON.parse(json.stdout).canvases[0]).toMatchObject({
		canvasId: CANVAS_ID,
		workspaceId: "workspace-1",
		title: "Drawing\u001b[31m",
	});
	f.setToolResult("list_canvases", {
		content: [],
		structuredContent: { canvases: [] },
	});
	expect((await f.run(["canvases", "list"])).stdout).toBe(
		"No standalone canvases found.\n",
	);
	f.setWorkspaces([
		{ id: "a", name: "A", role: "owner" },
		{ id: "b", name: "B", role: "owner" },
	]);
	expect((await f.run(["canvases", "list"])).stderr).toContain(
		"Select a workspace",
	);
});

test("renaming a page changes only its title and retains response metadata", async () => {
	const f = await setup();
	const result = await f.run([
		"pages",
		"rename",
		PAGE_ID,
		" New title ",
		"--json",
	]);
	expect(result.code).toBe(0);
	expect(f.calls.at(-1)).toEqual({
		name: "update_page",
		arguments: {
			workspaceId: "workspace-1",
			pageId: PAGE_ID,
			title: "New title",
		},
	});
	expect(JSON.parse(result.stdout)).toEqual({
		pageId: PAGE_ID,
		title: "New title",
		parentPageId: null,
	});
	expect(
		(await f.run(["pages", "rename", PAGE_ID, "Another title"])).stdout,
	).toBe(`Renamed to Another title\n${PAGE_ID}\n`);
});

test("task update distinguishes omitted fields from clearing the date, and reopen calls the matching tool", async () => {
	const f = await setup();
	for (const [flags, changes] of [
		[["--title", " New task title "], { title: "New task title" }],
		[["--due", "2028-02-29"], { dueDate: "2028-02-29" }],
		[["--clear-due"], { dueDate: null }],
		[
			["--title", "Renamed", "--due", "2026-12-12"],
			{ title: "Renamed", dueDate: "2026-12-12" },
		],
	] as const) {
		const result = await f.run([
			"tasks",
			"update",
			TASK_ID,
			...flags,
			"--json",
		]);
		expect(result.code).toBe(0);
		expect(f.calls.at(-1)).toEqual({
			name: "update_task",
			arguments: { workspaceId: "workspace-1", taskId: TASK_ID, ...changes },
		});
		expect(JSON.parse(result.stdout).taskId).toBe(TASK_ID);
	}
	const reopened = await f.run(["tasks", "reopen", TASK_ID, "--json"]);
	expect(reopened.code).toBe(0);
	expect(JSON.parse(reopened.stdout).completed).toBe(false);
	expect(f.calls.at(-1)).toEqual({
		name: "reopen_task",
		arguments: { workspaceId: "workspace-1", taskId: TASK_ID },
	});
	expect((await f.run(["tasks", "reopen", TASK_ID])).stdout).toStartWith(
		"Reopened ",
	);
	expect(
		(await f.run(["tasks", "update", TASK_ID, "--clear-due"])).stdout,
	).toStartWith("Updated ");
});

test("invalid new commands fail before any tool request", async () => {
	const f = await setup();
	for (const args of [
		["search", "x"],
		["search", "x".repeat(201)],
		["search", "ok", "--limit", "51"],
		["search", "ok", "--kind", "pages"],
		["search", "ok", "--cursor", "x".repeat(4097)],
		["canvases", "list", "--limit", "10"],
		["pages", "rename", PAGE_ID],
		["pages", "rename", PAGE_ID, "two", "words"],
		["pages", "rename", PAGE_ID, " "],
		["pages", "rename", PAGE_ID, "x".repeat(301)],
		["pages", "rename", "not-an-id", "Title"],
		["tasks", "update", TASK_ID],
		["tasks", "update", TASK_ID, "--due", "2026-02-29"],
		["tasks", "update", TASK_ID, "--due", "2026-12-12", "--clear-due"],
		["tasks", "update", TASK_ID, "--title", " "],
		["tasks", "update", TASK_ID, "--title", "x".repeat(1001)],
		["tasks", "update", "not-an-id", "--clear-due"],
		["tasks", "reopen", "not-an-id"],
		["tasks", "reopen", TASK_ID, "--due", "2026-12-12"],
	]) {
		const result = await f.run([...args, "--json"]);
		expect(result.code).toBe(1);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr).error).toBeString();
	}
	expect(f.calls).toHaveLength(0);
});

test("failed friendly mutations report errors without retrying", async () => {
	const f = await setup();
	f.setToolError();
	for (const args of [
		["pages", "rename", PAGE_ID, "Title"],
		["tasks", "update", TASK_ID, "--clear-due"],
		["tasks", "reopen", TASK_ID],
	]) {
		const before = f.calls.length;
		const result = await f.run([...args, "-w", "team", "--json"]);
		expect(result.code).toBe(1);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr).error).toContain("do not have access");
		expect(f.calls).toHaveLength(before + 1);
	}
});
