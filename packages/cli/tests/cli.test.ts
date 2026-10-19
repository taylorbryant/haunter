import { afterEach, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArguments } from "../src/args";
import { ProfileStore, serverUrl } from "../src/config";
import { fixture, PAGE_ID, TASK_ID } from "./helpers";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of disposers.splice(0)) await close();
});
async function setup(signedIn = true) {
	const f = await fixture();
	disposers.push(f.close);
	if (signedIn) await f.signIn();
	return f;
}

test("OAuth login uses PKCE, stores private credentials, and refreshes expired access tokens", async () => {
	const f = await setup();
	expect((await stat(f.store.path)).mode & 0o777).toBe(0o600);
	expect((await stat(f.directory)).mode & 0o777).toBe(0o700);
	const before = await f.store.load();
	expect(before.tokens?.access_token).toBe("access-1");
	expect(before.tokens?.issuer).toBe(new URL(f.store.server).origin);
	expect(await readFile(f.store.path, "utf8")).not.toContain("code_verifier");
	f.expire();
	const result = await f.run(["pages", "list", "--json"]);
	expect(result.code).toBe(0);
	expect(JSON.parse(result.stdout).pages[0].pageId).toBe(PAGE_ID);
	expect(f.refreshes).toBe(1);
	expect((await f.store.load()).tokens?.refresh_token).toBe("refresh-2");
	expect(result.stderr).toBe("");
});

test("signed-out and revoked sessions fail without a browser or hanging", async () => {
	const f = await setup(false);
	expect(await f.run(["pages", "list", "--json"])).toMatchObject({
		code: 1,
		stdout: "",
	});
	await f.signIn();
	f.revoke();
	const result = await f.run(["pages", "list"]);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("haunter login");
});

test("workspace selection is explicit when ambiguous and can be overridden per command", async () => {
	const f = await setup();
	f.setWorkspaces([
		{ id: "workspace-1", name: "Personal", role: "owner" },
		{ id: "workspace-2", name: "Team", role: "member" },
	]);
	expect((await f.run(["pages", "list"])).stderr).toContain(
		"Select a workspace",
	);
	expect((await f.run(["workspaces", "use", "unknown"])).code).toBe(1);
	expect((await f.run(["workspaces", "use", "workspace-2"])).code).toBe(0);
	expect((await f.store.load()).workspaceId).toBe("workspace-2");
	await f.run(["pages", "list", "-w", "workspace-1"]);
	expect(f.calls.at(-1)?.arguments.workspaceId).toBe("workspace-1");
	await f.run(["pages", "list"]);
	expect(f.calls.at(-1)?.arguments.workspaceId).toBe("workspace-2");
});

test("pages can be searched and read with clean terminal text or exact JSON", async () => {
	const f = await setup();
	const listed = await f.run(["pages", "list"]);
	expect(listed.stdout).toContain("Notes");
	expect(listed.stdout).not.toContain("\u001b");
	await f.run(["pages", "search", "meeting notes"]);
	expect(f.calls.at(-1)).toEqual({
		name: "search_pages",
		arguments: { workspaceId: "workspace-1", query: "meeting notes" },
	});
	expect((await f.run(["pages", "read", PAGE_ID])).stdout).toBe(
		"# Hello\n\nA page body.\n",
	);
});

test("capture reads stdin/files and appends without replacing page content", async () => {
	const f = await setup();
	const markdown = "## Meeting\n\nHello **world**.\n";
	expect(
		(await f.run(["capture", "--title", "Meeting notes", "--json"], markdown))
			.code,
	).toBe(0);
	expect(f.calls.at(-1)).toEqual({
		name: "create_page",
		arguments: { workspaceId: "workspace-1", title: "Meeting notes", markdown },
	});
	const path = join(f.directory, "notes.md");
	await writeFile(path, markdown);
	await f.run(["capture", "--file", path, "--page", PAGE_ID]);
	expect(f.calls.at(-1)).toEqual({
		name: "append_to_page",
		arguments: { workspaceId: "workspace-1", pageId: PAGE_ID, markdown },
	});
	await f.run(["capture", "An idea for later", "--parent", PAGE_ID]);
	expect(f.calls.at(-1)?.arguments).toMatchObject({
		title: "An idea for later",
		markdown: "An idea for later",
		parentPageId: PAGE_ID,
	});
	await f.run(["capture", "--", "--json"]);
	expect(f.calls.at(-1)?.arguments.markdown).toBe("--json");
});

test("invalid or oversized capture input never reaches the server", async () => {
	const f = await setup();
	for (const args of [
		["capture"],
		["capture", "text", "--file", "file.md"],
		["capture", "text", "--page", PAGE_ID, "--title", "bad"],
		["capture", "x".repeat(100_001)],
	]) {
		expect((await f.run(args)).code).toBe(1);
	}
	expect((await f.run(["capture"], " ")).code).toBe(1);
	expect(f.calls).toHaveLength(0);
});

test("task commands send the published tool arguments and preserve filters", async () => {
	const f = await setup();
	expect(
		(await f.run(["tasks", "add", "Review proposal", "--due", "2026-12-12"]))
			.code,
	).toBe(0);
	expect(f.calls.at(-1)).toEqual({
		name: "create_task",
		arguments: {
			workspaceId: "workspace-1",
			title: "Review proposal",
			dueDate: "2026-12-12",
		},
	});
	await f.run([
		"tasks",
		"list",
		"--due",
		"today",
		"--filter",
		"all",
		"--scope",
		"everyone",
		"--limit",
		"200",
	]);
	expect(f.calls.at(-1)?.arguments).toEqual({
		workspaceId: "workspace-1",
		due: "today",
		filter: "all",
		scope: "everyone",
		limit: 200,
	});
	await f.run(["tasks", "done", TASK_ID]);
	expect(f.calls.at(-1)).toEqual({
		name: "complete_task",
		arguments: { workspaceId: "workspace-1", taskId: TASK_ID },
	});
});

test("failed mutations report an error and are not retried", async () => {
	const f = await setup();
	f.setToolError();
	const result = await f.run([
		"capture",
		"Hello",
		"--workspace",
		"workspace-1",
		"--json",
	]);
	expect(result.code).toBe(1);
	expect(result.stdout).toBe("");
	expect(JSON.parse(result.stderr).error).toContain("do not have access");
	expect(f.calls).toHaveLength(1);
});

test("logout removes tokens, status never prints credentials, servers are isolated", async () => {
	const f = await setup();
	const status = await f.run(["status", "--json"]);
	expect(JSON.parse(status.stdout).signedIn).toBe(true);
	expect(status.stdout).not.toContain("access-1");
	const other = new ProfileStore(f.directory, "https://example.com/mcp");
	expect((await other.load()).tokens).toBeUndefined();
	await f.run(["logout"]);
	expect((await f.store.load()).tokens).toBeUndefined();
	expect((await f.run(["pages", "list"])).code).toBe(1);
});

test("profile locks prevent concurrent token rotation and always release after command errors", async () => {
	const f = await setup();
	const release = await f.store.lock();
	expect((await f.run(["status"])).stderr).toContain("Another Haunter command");
	await release();
	expect((await f.run(["status"])).code).toBe(0);
	await writeFile(f.store.path, "invalid");
	expect((await f.run(["status"])).code).toBe(1);
	const unlock = await f.store.lock();
	await unlock();
});

test.each(
	[
		["tasks", "add", "x", "--due", "2026-02-30"],
		["tasks", "list", "--limit", "201"],
		["pages", "list", "--title", "ignored"],
		["pages", "search", "not", "quoted"],
		["capture", "x", "--workspace", "a", "--workspace", "b"],
		["tasks", "done"],
	].map((args) => ({ args })),
)("rejects invalid arguments: %j", ({ args }) => {
	expect(() => parseArguments(args)).toThrow();
});

test("server addresses require HTTPS except local development", () => {
	expect(serverUrl("https://www.haunter.app")).toBe(
		"https://www.haunter.app/mcp",
	);
	expect(serverUrl("http://localhost:3000")).toBe("http://localhost:3000/mcp");
	for (const url of [
		"http://example.com",
		"https://user:secret@example.com/mcp",
		"https://example.com/mcp?token=x",
		"file:///tmp/test",
	])
		expect(() => serverUrl(url)).toThrow();
});
