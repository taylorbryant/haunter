import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Locator } from "playwright";

// Only preview:mcp-editor's disposable database is mutated.
const output = "/private/tmp/haunter-navigation-proof";
await mkdir(output, { recursive: true });
const stamp = Date.now();
const parentName = `HTTP parent ${stamp}`;
const childName = `HTTP child ${stamp}`;
const canvasName = `HTTP drawing ${stamp}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 1050 },
});
context.setDefaultTimeout(30_000);
const page = await context.newPage();
const errors: string[] = [];
const calls: string[] = [];
const requests: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
	const url = new URL(request.url());
	if (url.pathname === "/mcp")
		calls.push(request.postDataJSON()?.params?.name ?? "");
	if (url.pathname.startsWith("/api/"))
		requests.push(`${request.method()} ${url.pathname}`);
});
const app = page.frameLocator("#app");
const workspace = app.frameLocator("#real-editor");
const body = workspace.getByRole("textbox", { name: "", exact: true });
const title = workspace.getByRole("textbox", {
	name: "Page title",
	exact: true,
});
const tree = (id: string) =>
	workspace.locator(`li[draggable="true"]:has(> a[href$="/p/${id}"])`).first();
async function view() {
	return JSON.parse(
		(await page.locator("#context").textContent())?.split("\n")[1] ?? "null",
	);
}
async function waitView(expected: Record<string, unknown>) {
	await page.waitForFunction((expected) => {
		try {
			const current = JSON.parse(
				document.getElementById("context")?.textContent?.split("\n")[1] ??
					"null",
			);
			return (
				current &&
				Object.entries(expected).every(([key, value]) => current[key] === value)
			);
		} catch {
			return false;
		}
	}, expected);
}
async function saved() {
	await waitView({ saveStatus: "saved" });
}
async function end(editor: Locator) {
	await editor.evaluate((element) => {
		element.focus();
		const range = document.createRange();
		range.selectNodeContents(
			element.querySelector(".bn-inline-content:last-child") ?? element,
		);
		range.collapse(false);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	});
	await editor.press("End");
	await editor.press("Enter");
}
async function slash(name: string) {
	await end(body);
	await body.pressSequentially(`/${name}`);
	await workspace
		.getByRole("option", { name: new RegExp(`^${name}`) })
		.first()
		.click();
}
try {
	await page.goto("http://localhost:8797/");
	await body.waitFor();
	await saved();
	const frameUrl = await app.locator("#real-editor").getAttribute("src");
	const bootCalls = calls.length;
	await workspace
		.locator("header")
		.getByRole("button", { name: "Create page", exact: true })
		.click();
	await workspace
		.getByRole("textbox", { name: "Title", exact: true })
		.fill(parentName);
	await workspace
		.getByRole("button", { name: "Create page", exact: true })
		.last()
		.click();
	await waitView({ title: parentName });
	await body.waitFor();
	await saved();
	const parentId = (await view()).pageId;
	await tree(parentId)
		.getByRole("button", { name: "Add subpage", exact: true })
		.click();
	await waitView({ title: "Untitled" });
	await title.fill(childName);
	await body.click();
	await waitView({ title: childName });
	await saved();
	const childId = (await view()).pageId;
	await workspace
		.locator("header")
		.getByRole("link", { name: parentName, exact: true })
		.click();
	await waitView({ pageId: parentId });
	await body.getByRole("button", { name: childName, exact: true }).click();
	await waitView({ pageId: childId });
	console.log(
		"PASS: shared React creation, subpages, breadcrumbs and internal links use HTTP inside one frame",
	);
	await tree(childId)
		.getByRole("button", { name: "Page actions", exact: true })
		.click();
	await workspace
		.getByRole("menuitem", { name: "Add to favorites", exact: true })
		.click();
	await workspace
		.locator('[data-sidebar="group"]')
		.filter({ has: workspace.getByText("Favorites", { exact: true }) })
		.getByRole("link", { name: childName, exact: true })
		.waitFor();
	// A real HTML drag moves a child before its parent, making it a root page.
	const box = await tree(parentId).boundingBox();
	assert.ok(box);
	await tree(childId).dragTo(tree(parentId), {
		targetPosition: { x: 100, y: 1 },
	});
	await workspace
		.locator("header")
		.getByRole("link", { name: parentName, exact: true })
		.waitFor({ state: "hidden" });
	await workspace
		.getByRole("button", { name: /Search/ })
		.first()
		.click();
	const searchResponse = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/api/search" &&
			response.status() === 200,
	);
	await workspace
		.getByPlaceholder("Search pages, or > for commands...")
		.fill(parentName);
	await searchResponse;
	await workspace
		.getByRole("option", { name: new RegExp(parentName) })
		.first()
		.click();
	await waitView({ pageId: parentId });
	console.log(
		"PASS: favorites, drag-and-drop moves, and the shared search dialog use ordinary APIs",
	);
	await slash("Page");
	await waitView({ title: "Untitled" });
	await body.waitFor();
	const slashId = (await view()).pageId;
	assert.notEqual(slashId, parentId);
	await title.fill(`Slash page ${stamp}`);
	await body.click();
	await saved();
	await slash("Canvas");
	await workspace.locator(".tl-canvas").waitFor();
	await saved();
	console.log(
		"PASS: /Page and /Canvas create through HTTP; the canvas renders inline",
	);
	await tree(slashId)
		.getByRole("button", { name: "Page actions", exact: true })
		.click();
	await workspace
		.getByRole("menuitem", { name: "Move to trash", exact: true })
		.click();
	await workspace
		.getByRole("button", { name: "Move to trash", exact: true })
		.click();
	await page.waitForFunction(() =>
		document
			.getElementById("context")
			?.textContent?.startsWith("No Haunter page"),
	);
	await workspace.getByRole("link", { name: "Trash", exact: true }).click();
	await workspace
		.locator("li")
		.filter({ hasText: `Slash page ${stamp}` })
		.getByRole("button", { name: /Restore/ })
		.click();
	await waitView({ pageId: slashId });
	await workspace.locator(".tl-canvas").waitFor();
	console.log(
		"PASS: the shared trash flow archives and restores a page with its canvas",
	);
	await workspace
		.locator("header")
		.getByRole("button", { name: "Create canvas", exact: true })
		.click();
	await workspace
		.getByRole("textbox", { name: "Title", exact: true })
		.fill(canvasName);
	await workspace
		.getByRole("button", { name: "Create canvas", exact: true })
		.last()
		.click();
	await waitView({ title: canvasName });
	await workspace.locator(".tl-canvas").waitFor();
	assert.ok((await view()).canvasId);
	assert.equal(await app.locator("#real-editor").getAttribute("src"), frameUrl);
	assert.deepEqual(calls.slice(bootCalls), []);
	assert.ok(requests.includes("POST /api/pages"));
	assert.ok(requests.includes("POST /api/canvases"));
	assert.ok(requests.some((request) => request.includes("/search")));
	assert.deepEqual(errors, []);
	await page.screenshot({ path: `${output}/workspace-http.png` });
	console.log(
		"PASS: standalone canvas creation works; all UI actions retained the iframe and issued zero MCP tool calls",
	);
} catch (error) {
	await page.screenshot({ path: `${output}/failure.png` });
	console.error((await workspace.locator("body").innerText()).slice(-2500));
	throw error;
} finally {
	await browser.close();
}
