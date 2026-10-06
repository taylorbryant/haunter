import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "playwright/test";
import type { CurrentPageContext } from "@/features/agents/mcp-app/model-context";

// Only the disposable, synthetic preview fixture; never the user's tunnel data.
const fixture = await (await fetch("http://localhost:8797/fixture")).json();
const output = "/private/tmp/haunter-task-context-proof";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 1080 },
});
context.setDefaultTimeout(30_000);
const page = await context.newPage();
const workspace = page.frameLocator("#app").frameLocator("#real-editor");
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const stamp = Date.now();
const title = `Context task ${stamp}`;
async function current(): Promise<CurrentPageContext | undefined> {
	const text = await page.locator("#context").textContent();
	try {
		return JSON.parse(text?.split("\n")[1] ?? "null") ?? undefined;
	} catch {
		return undefined;
	}
}
async function rpc(name: string, args: Record<string, unknown>) {
	const response = await fetch("http://localhost:8797/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			"Mcp-Protocol-Version": "2026-07-28",
			"Mcp-Method": "tools/call",
			"Mcp-Name": name,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "tools/call",
			params: {
				name,
				arguments: args,
				_meta: {
					"io.modelcontextprotocol/protocolVersion": "2026-07-28",
					"io.modelcontextprotocol/clientInfo": {
						name: "Task proof",
						version: "1.0.0",
					},
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		}),
	});
	const body = await response.json();
	assert.ok(!body.error && !body.result?.isError, JSON.stringify(body));
	return body.result;
}
async function assistantOpen(args: Record<string, unknown>) {
	const result = await rpc("open_haunter", args);
	await page.evaluate((result) => {
		document
			.querySelector<HTMLIFrameElement>("#app")
			?.contentWindow?.postMessage(
				{
					jsonrpc: "2.0",
					method: "ui/notifications/tool-result",
					params: result,
				},
				location.origin,
			);
	}, result);
}
async function openInlinePage() {
	const parent = workspace.locator(`li:has(> a[href$="/p/${fixture.pageId}"])`);
	const expand = parent.getByRole("button", { name: "Expand", exact: true });
	if (await expand.count()) await expand.click();
	await workspace
		.locator(`a[href$="/p/${fixture.secondPageId}"]`)
		.first()
		.click();
}
async function access(mode: string) {
	assert.equal(
		(
			await fetch("http://localhost:8797/test/access", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode }),
			})
		).status,
		204,
	);
}
try {
	await page.goto("http://localhost:8797/");
	await workspace
		.getByRole("textbox", { name: "Page title", exact: true })
		.waitFor();
	const frameSrc = await page
		.frameLocator("#app")
		.locator("#real-editor")
		.getAttribute("src");
	await workspace.getByRole("link", { name: "Home", exact: true }).click();
	await expect.poll(async () => (await current())?.section).toBe("home");
	await expect
		.poll(async () =>
			(await current())?.tasks?.lists.map((list) => list.view).sort(),
		)
		.toEqual(["today", "upcoming"]);
	await workspace
		.getByRole("textbox", { name: "Add a task", exact: true })
		.fill(title);
	await workspace
		.getByRole("textbox", { name: "Add a task", exact: true })
		.press("Enter");
	const row = workspace.locator("li[data-task-id]").filter({
		has: workspace.getByRole("button", { name: title, exact: true }),
	});
	await row.waitFor();
	await row.focus();
	await expect
		.poll(async () => (await current())?.tasks?.selectedTask?.title)
		.toBe(title);
	const taskId = (await current())?.tasks?.selectedTask?.taskId;
	assert.ok(taskId);
	await page
		.getByLabel("Conversation draft")
		.fill("Move this task to tomorrow");
	assert.equal((await current())?.tasks?.selectedTask?.taskId, taskId);
	await assistantOpen({
		workspaceId: fixture.workspaceId,
		view: "tasks",
		taskId,
	});
	await workspace
		.getByRole("button", { name: "Show all tasks", exact: true })
		.waitFor();
	await expect.poll(async () => (await current())?.section).toBe("tasks");
	await expect
		.poll(async () => (await current())?.tasks?.selectedTask?.taskId)
		.toBe(taskId);
	await expect(workspace.locator("li[data-task-id]")).toHaveCount(1);
	assert.equal(
		await page.frameLocator("#app").locator("#real-editor").getAttribute("src"),
		frameSrc,
	);
	await row.getByRole("button", { name: /^Assigned to/ }).click();
	await workspace.getByRole("menuitem", { name: /Alex Example/ }).click();
	await expect
		.poll(async () => (await current())?.tasks?.selectedTask?.assigneeId)
		.toBe(fixture.assigneeId);
	await row.getByRole("button", { name: /^Due date/ }).click();
	await workspace.getByRole("button", { name: /^Tomorrow/ }).click();
	await workspace.getByLabel("Due time", { exact: true }).fill("14:30");
	await workspace.getByRole("button", { name: "Done", exact: true }).click();
	await expect
		.poll(async () => (await current())?.tasks?.selectedTask?.dueTime)
		.toBe("14:30");
	await row.getByRole("checkbox", { name: "Mark task done" }).click();
	await expect
		.poll(async () => (await current())?.tasks?.selectedTask?.completed)
		.toBe(true);
	await page.screenshot({ path: `${output}/focused-task.png` });
	await workspace
		.getByRole("button", { name: "Show all tasks", exact: true })
		.click();
	await expect
		.poll(async () => (await current())?.tasks?.selectedTask)
		.toBeUndefined();
	await workspace.getByRole("button", { name: "Mine", exact: true }).click();
	await expect
		.poll(async () => (await current())?.tasks?.lists[0]?.scope)
		.toBe("mine");
	await expect(row).toHaveCount(0);
	await assistantOpen({ workspaceId: fixture.workspaceId, taskId });
	await expect
		.poll(async () => (await current())?.tasks?.selectedTask?.taskId)
		.toBe(taskId);
	await expect(
		row.getByRole("checkbox", { name: "Mark task open" }),
	).toBeVisible();
	console.log(
		"PASS: Home/Tasks context, focus retention in composer, assistant task navigation, live fields, filters and completed task reopening",
	);

	await openInlinePage();
	const inline = workspace.locator(".haunter-task").first();
	await inline.waitFor();
	await inline.getByRole("button", { name: /^Assigned to/ }).click();
	await workspace.getByRole("menuitem", { name: /Alex Example/ }).click();
	await inline.getByRole("button", { name: /^Due date/ }).click();
	await workspace.getByRole("button", { name: /^Tomorrow/ }).click();
	await workspace.getByLabel("Due time", { exact: true }).fill("15:45");
	await workspace.getByRole("button", { name: "Done", exact: true }).click();
	await expect
		.poll(async () => (await current())?.selectedTask?.dueTime)
		.toBe("15:45");
	const selected = (await current())?.selectedTask;
	assert.equal(selected?.pageId, fixture.secondPageId);
	assert.equal(selected?.sourceBlockId, "rich-task");
	assert.equal(selected?.assigneeId, fixture.assigneeId);
	assert.equal(selected?.taskId, null);
	await expect
		.poll(async () => (await current())?.saveStatus, { timeout: 30_000 })
		.toBe("saved");
	await page.screenshot({ path: `${output}/inline-task.png` });
	const saved = await rpc("read_page", {
		format: "blocks",
		workspaceId: fixture.workspaceId,
		pageId: fixture.secondPageId,
	});
	assert.ok(JSON.stringify(saved).includes("15:45"));
	assert.ok(JSON.stringify(saved).includes(fixture.assigneeId));
	const web = await context.newPage();
	await web.goto("http://127.0.0.1:8797/login");
	await web.goto(
		`${fixture.appOrigin}/w/${fixture.workspaceId}/p/${fixture.secondPageId}`,
	);
	await expect(
		web
			.locator(".haunter-task")
			.first()
			.getByRole("button", { name: /Due date.*3:45/ }),
	).toBeVisible();
	await web.close();
	await workspace
		.locator(".bn-editor .bn-block-content[data-content-type=paragraph]")
		.first()
		.click();
	await expect
		.poll(async () => (await current())?.selectedTask)
		.toBeUndefined();
	console.log(
		"PASS: inline assignment/date edits save to the page, agree with MCP and web reads, and clear selection on another block",
	);
	await access("view");
	await page.reload();
	await workspace
		.getByRole("textbox", { name: "Page title", exact: true })
		.waitFor();
	await openInlinePage();
	await expect(
		workspace.locator(".haunter-task").first().getByRole("checkbox"),
	).toBeDisabled();
	await expect(
		workspace
			.locator(".haunter-task")
			.first()
			.getByRole("button", { name: /^Assigned to/ }),
	).toHaveCount(0);
	await access("edit");
	assert.deepEqual(errors, []);
	console.log(
		"PASS: read-only embedded consent keeps inline controls disabled; no browser runtime errors",
	);
} catch (error) {
	await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
	console.error(
		await workspace
			.locator("body")
			.innerText()
			.catch(() => "No workspace frame"),
	);
	console.error("Host context:", await current());
	throw error;
} finally {
	await access("edit");
	await browser.close();
}
