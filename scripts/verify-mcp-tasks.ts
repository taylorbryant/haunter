import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Uses preview:mcp-editor's synthetic accounts and disposable database only.
const output = "/private/tmp/haunter-tasks-proof";
await mkdir(output, { recursive: true });
const fixture = await (await fetch("http://localhost:8797/fixture")).json();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 1080 },
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
const stamp = Date.now();
const todayTitle = `Review Home ${stamp}`;
const upcomingTitle = `Prepare release ${stamp}`;
const renamedTitle = `Review task parity ${stamp}`;
const row = (title: string) =>
	workspace.locator("li").filter({
		has: workspace.getByRole("button", { name: title, exact: true }),
	});
async function sidebar(name: string) {
	await workspace.getByRole("link", { name, exact: true }).click();
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
	const src = await app.locator("#real-editor").getAttribute("src");
	calls.length = 0;
	await workspace
		.locator(`li:has(> a[href$="/p/${fixture.pageId}"])`)
		.getByRole("button", { name: "Page actions", exact: true })
		.click();
	const favorite = workspace.getByRole("menuitem", {
		name: "Add to favorites",
		exact: true,
	});
	if (await favorite.count()) await favorite.click();
	else
		await workspace
			.getByRole("menuitem", { name: "Remove from favorites", exact: true })
			.press("Escape");
	await workspace
		.getByRole("combobox", { name: "Haunter theme" })
		.selectOption("dracula");
	await sidebar("Home");
	await workspace.getByRole("heading", { name: "Home", exact: true }).waitFor();
	await workspace
		.getByRole("heading", { name: "Coming up", exact: true })
		.waitFor();
	await workspace
		.getByRole("region", { name: "Favorites", exact: true })
		.getByRole("link", { name: /Real editor proof/ })
		.click();
	await workspace
		.getByRole("textbox", { name: "Page title", exact: true })
		.waitFor();
	await sidebar("Home");
	await workspace
		.getByRole("region", { name: "Favorites", exact: true })
		.getByRole("link", { name: /Real editor proof/ })
		.waitFor();
	await workspace
		.getByRole("textbox", { name: "Add a task", exact: true })
		.fill(todayTitle);
	await workspace
		.getByRole("textbox", { name: "Add a task", exact: true })
		.press("Enter");
	await row(todayTitle).waitFor();
	await workspace
		.getByRole("button", { name: "Create task", exact: true })
		.click();
	const dialog = workspace.getByRole("dialog");
	await dialog
		.getByRole("textbox", { name: "Task name" })
		.fill(`${upcomingTitle} tomorrow at 2pm`);
	await dialog.getByRole("button", { name: "Add task", exact: true }).click();
	await dialog.waitFor({ state: "hidden" });
	await row(upcomingTitle).waitFor();
	await page.screenshot({ path: `${output}/home-dracula.png` });
	await sidebar("Tasks");
	await workspace
		.getByRole("heading", { name: "Tasks", exact: true })
		.waitFor();
	await row(todayTitle)
		.getByRole("button", { name: todayTitle, exact: true })
		.click();
	await workspace
		.getByRole("textbox", { name: "Task name" })
		.fill(renamedTitle);
	await workspace.getByRole("textbox", { name: "Task name" }).press("Enter");
	await row(renamedTitle)
		.getByRole("button", { name: /^Assigned to/ })
		.click();
	await workspace.getByRole("menuitem", { name: /Alex Example/ }).click();
	await row(renamedTitle)
		.getByRole("button", { name: "Assigned to Alex Example", exact: true })
		.waitFor();
	await row(renamedTitle)
		.getByRole("button", { name: /^Due date/ })
		.click();
	await workspace.getByRole("button", { name: /^Tomorrow/ }).click();
	await workspace.getByLabel("Due time", { exact: true }).fill("14:30");
	await workspace.getByRole("button", { name: "Done", exact: true }).click();
	await row(renamedTitle)
		.getByRole("button", { name: /Due date.*Tomorrow.*2:30/ })
		.waitFor();
	await workspace.getByRole("button", { name: "Mine", exact: true }).click();
	await row(renamedTitle).waitFor({ state: "hidden" });
	await row(upcomingTitle).waitFor();
	await workspace
		.getByRole("button", { name: "Everyone", exact: true })
		.click();
	await row(renamedTitle).waitFor();
	await row(renamedTitle)
		.getByRole("checkbox", { name: "Mark task done" })
		.click();
	await row(renamedTitle).waitFor({ state: "hidden" });
	await workspace
		.getByRole("button", { name: "Completed", exact: true })
		.click();
	await row(renamedTitle)
		.getByRole("checkbox", { name: "Mark task open" })
		.waitFor();
	await workspace.getByRole("button", { name: "All", exact: true }).click();
	await row(upcomingTitle).waitFor();
	await page.screenshot({ path: `${output}/tasks-dracula.png` });
	assert.equal(await app.locator("#real-editor").getAttribute("src"), src);
	assert.deepEqual(calls, []);
	assert.ok(requests.includes("POST /api/tasks"));
	assert.ok(
		requests.includes(`GET /api/workspaces/${fixture.workspaceId}/members`),
	);
	assert.ok(
		!requests.some((request) => request.includes("/api/auth/organization")),
	);
	console.log(
		"PASS: shared Home quick add, upcoming, task dialog, rename, assignment, due date/time, completion and filters use HTTP and retain the iframe",
	);

	const web = await context.newPage();
	await web.goto("http://127.0.0.1:8797/login");
	await web.goto(
		`${fixture.appOrigin}/w/${fixture.workspaceId}/tasks?filter=all`,
	);
	const webRow = web.locator("li").filter({
		has: web.getByRole("button", { name: renamedTitle, exact: true }),
	});
	await webRow
		.getByRole("button", { name: "Assigned to Alex Example", exact: true })
		.waitFor();
	await webRow
		.getByRole("button", { name: "Assigned to Alex Example", exact: true })
		.click();
	await web.getByRole("menuitem", { name: /Alex Example/ }).press("Escape");
	await webRow
		.getByRole("button", { name: /Due date.*Tomorrow.*2:30/ })
		.waitFor();
	await webRow.getByRole("checkbox", { name: "Mark task open" }).click();
	await webRow.getByRole("checkbox", { name: "Mark task done" }).waitFor();
	await page.bringToFront();
	await row(renamedTitle)
		.getByRole("checkbox", { name: "Mark task done" })
		.waitFor({ timeout: 45_000 });
	await web.close();
	console.log(
		"PASS: task fields persist in the regular web app; web completion changes reach the embedded list",
	);

	let releaseWrite!: () => void;
	let observeWrite!: () => void;
	const heldWrite = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	const writeStarted = new Promise<void>((resolve) => {
		observeWrite = resolve;
	});
	await page.route("**/api/tasks/*", async (route) => {
		if (route.request().method() !== "PATCH") return route.continue();
		observeWrite();
		await heldWrite;
		await route.continue();
	});
	try {
		await row(renamedTitle)
			.getByRole("checkbox", { name: "Mark task done" })
			.click();
		await writeStarted;
		await workspace.getByRole("button", { name: /^Workspace:/ }).click();
		await workspace
			.getByRole("menuitem", { name: "Team workspace", exact: true })
			.click();
		await workspace.locator("body[inert]").waitFor({ state: "attached" });
		assert.match(
			await workspace.locator('button[aria-label^="Workspace:"]').innerText(),
			/Editor proof/,
		);
	} finally {
		releaseWrite();
	}
	await workspace
		.getByRole("button", { name: "Workspace: Team workspace", exact: true })
		.waitFor();
	await workspace.getByRole("heading", { name: "Home", exact: true }).waitFor();
	await page.unroute("**/api/tasks/*");
	await workspace.getByRole("button", { name: /^Workspace:/ }).click();
	await workspace
		.getByRole("menuitem", { name: "Editor proof", exact: true })
		.click();
	await workspace
		.getByRole("button", { name: "Workspace: Editor proof", exact: true })
		.waitFor();
	await sidebar("Tasks");
	await workspace
		.getByRole("button", { name: "Completed", exact: true })
		.click();
	await row(renamedTitle)
		.getByRole("checkbox", { name: "Mark task open" })
		.click();
	await workspace.getByRole("button", { name: "Open", exact: true }).click();
	await row(renamedTitle).waitFor();
	console.log(
		"PASS: workspace switching waits for a delayed task write and preserves its result",
	);

	await page.getByRole("combobox", { name: "Width" }).selectOption("390");
	await workspace
		.getByRole("heading", { name: "Tasks", exact: true })
		.waitFor();
	const geometry = await workspace
		.locator("html")
		.evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
	assert.ok(geometry.scroll <= geometry.width, JSON.stringify(geometry));
	await page.screenshot({ path: `${output}/tasks-narrow.png` });
	await page.getByRole("combobox", { name: "Width" }).selectOption("full");
	await sidebar("Home");
	await row(upcomingTitle).waitFor();
	await page.reload();
	await workspace
		.getByRole("textbox", { name: "Page title", exact: true })
		.waitFor();
	await sidebar("Tasks");
	await row(renamedTitle).waitFor();
	await access("view");
	await page.reload();
	await workspace
		.getByRole("textbox", { name: "Page title", exact: true })
		.waitFor();
	await sidebar("Tasks");
	await workspace.getByText(renamedTitle, { exact: true }).waitFor();
	assert.equal(
		await workspace
			.getByRole("button", { name: "Create task", exact: true })
			.count(),
		0,
	);
	assert.equal(
		await workspace
			.getByRole("checkbox", { name: "Mark task done" })
			.first()
			.isDisabled(),
		true,
	);
	console.log("PASS: narrow layout, reopening and view-only task controls");
	assert.deepEqual(errors, []);
} catch (error) {
	await page.screenshot({ path: `${output}/failure.png` });
	await Bun.write(
		`${output}/failure.txt`,
		await workspace
			.locator("body")
			.innerText()
			.catch(() => "No editor"),
	);
	throw error;
} finally {
	await access("edit");
	await browser.close();
}
