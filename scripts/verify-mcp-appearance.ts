import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Only preview:mcp-editor's disposable local workspace is used by this proof.
const output = "/private/tmp/haunter-appearance-proof";
await mkdir(output, { recursive: true });
const fixture = await (await fetch("http://localhost:8797/fixture")).json();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 1080 },
});
context.setDefaultTimeout(30_000);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const app = page.frameLocator("#app");
const editor = app.frameLocator("#real-editor");
const title = editor.getByRole("textbox", { name: "Page title", exact: true });
async function selectTheme(value: string) {
	await editor
		.getByRole("combobox", { name: "Haunter theme", exact: true })
		.selectOption(value);
}
async function noOverflow() {
	for (const locator of [app.locator("html"), editor.locator("html")]) {
		const size = await locator.evaluate((el) => ({
			width: el.clientWidth,
			scroll: el.scrollWidth,
		}));
		assert.ok(size.scroll <= size.width, JSON.stringify(size));
	}
}
try {
	await page.goto("http://localhost:8797/");
	await title.waitFor();
	const web = await context.newPage();
	await web.goto("http://127.0.0.1:8797/login");
	await web.goto(fixture.webUrl);
	await web.getByRole("textbox", { name: "Page title", exact: true }).waitFor();
	await web.getByRole("link", { name: "Tasks", exact: true }).waitFor();
	await web.getByRole("button", { name: /^Open page history/ }).waitFor();
	await web.getByRole("button", { name: /^Workspace:/ }).click();
	await web
		.getByRole("menuitem", { name: "Edit workspace", exact: true })
		.click();
	await web
		.getByRole("dialog", { name: "Edit workspace", exact: true })
		.waitFor();
	await web.getByLabel("Name", { exact: true }).waitFor();
	await web.getByLabel("Name", { exact: true }).press("Escape");
	await web
		.getByRole("dialog", { name: "Edit workspace", exact: true })
		.waitFor({ state: "hidden" });
	await web.getByRole("button", { name: /^Workspace:/ }).click();
	await web
		.getByRole("menuitem", { name: "Team workspace", exact: true })
		.click();
	await web.waitForURL(`**/w/${fixture.secondWorkspaceId}/home`);
	await web.goto(fixture.webUrl);
	await web.getByRole("textbox", { name: "Page title", exact: true }).waitFor();
	assert.equal(
		await editor.getByRole("link", { name: "Tasks", exact: true }).count(),
		1,
	);
	assert.equal(
		await editor.getByRole("button", { name: /^Open page history/ }).count(),
		0,
	);
	await editor
		.locator("header")
		.getByText(/^(Just now|Saved|Edited .+)$/)
		.waitFor();
	await editor.getByRole("button", { name: /^Workspace:/ }).click();
	assert.equal(
		await editor
			.getByRole("menuitem", { name: "New workspace", exact: true })
			.count(),
		0,
	);
	assert.equal(
		await editor
			.getByRole("menuitem", { name: "Members", exact: true })
			.count(),
		0,
	);
	await editor
		.getByRole("menuitem", { name: "Editor proof", exact: true })
		.click();
	// Selecting the current workspace should leave its page open.
	await title.waitFor();
	console.log(
		"PASS: shared web picker preserves switching and management dialogs; embedded controls remain scoped and show save status",
	);
	const webTheme = await web.locator("html").getAttribute("class");
	const webPreferences = await web.evaluate(() =>
		Object.fromEntries(
			Object.entries(localStorage).filter(
				([key]) => key === "theme" || key.startsWith("haunter-theme-"),
			),
		),
	);
	await page.bringToFront();
	await selectTheme("dracula");
	await editor.locator("html.dracula").waitFor();

	assert.equal(
		await editor
			.locator("[data-slot=sidebar-wrapper]")
			.evaluate((el) => getComputedStyle(el).backgroundColor),
		"rgb(40, 42, 54)",
	);
	await page.getByRole("button", { name: "Switch theme" }).click();
	await editor.locator("html.dracula").waitFor();
	await page.screenshot({ path: `${output}/dracula-expanded.png` });
	const src = await app.locator("#real-editor").getAttribute("src");
	await editor.locator('[data-slot="sidebar-trigger"]').click();
	await editor
		.locator('[data-state="collapsed"][data-slot="sidebar"]')
		.waitFor({ state: "attached" });
	assert.equal(await app.locator("#real-editor").getAttribute("src"), src);
	await title.waitFor();
	await page.screenshot({ path: `${output}/dracula-collapsed.png` });
	await page.reload();
	await title.waitFor();
	await editor.locator("html.dracula").waitFor();
	await editor.locator('[data-slot="sidebar-trigger"]').waitFor();
	console.log(
		"PASS: Dracula styles the shell and editor, survives host changes/reopening, and remembers the collapsed sidebar",
	);
	await page.getByRole("combobox", { name: "Width" }).selectOption("390");
	await editor.locator('[data-slot="sidebar-trigger"]').click();
	await editor.getByRole("dialog").waitFor();
	await editor.getByRole("button", { name: /^Workspace:/ }).click();
	await editor
		.getByRole("dialog", { name: "Workspaces", exact: true })
		.waitFor();
	assert.equal(
		await editor
			.getByRole("button", { name: "New workspace", exact: true })
			.count(),
		0,
	);
	await editor
		.getByRole("button", { name: "Team workspace", exact: true })
		.click();
	await editor.getByRole("heading", { name: "Home", exact: true }).waitFor();
	await editor.locator('[data-slot="sidebar-trigger"]').click();
	await editor.getByRole("button", { name: /^Workspace:/ }).click();
	await editor
		.getByRole("button", { name: "Editor proof", exact: true })
		.click();
	await editor.getByRole("heading", { name: "Home", exact: true }).waitFor();
	await editor.locator('[data-slot="sidebar-trigger"]').click();
	await page.screenshot({ path: `${output}/dracula-narrow-navigation.png` });
	console.log(
		"PASS: shared mobile workspace drawer switches scopes and preserves the embedded feature set",
	);
	const narrowSrc = await app.locator("#real-editor").getAttribute("src");
	await editor
		.getByRole("dialog")
		.locator(`a[href$="/p/${fixture.pageId}"]`)
		.first()
		.click();
	await title.waitFor();
	await editor.getByRole("dialog").waitFor({ state: "hidden" });
	assert.equal(
		await app.locator("#real-editor").getAttribute("src"),
		narrowSrc,
	);
	await noOverflow();
	await page.screenshot({ path: `${output}/dracula-narrow-editor.png` });
	await page.getByRole("combobox", { name: "Width" }).selectOption("full");
	await editor.locator('[data-slot="sidebar-trigger"]').click();
	const expand = editor
		.locator(`li:has(> a[href$="/p/${fixture.pageId}"])`)
		.getByRole("button", { name: "Expand", exact: true });
	if (await expand.count()) await expand.click();
	await editor.locator(`a[href$="/p/${fixture.secondPageId}"]`).first().click();
	await editor.locator(".tl-canvas").waitFor();
	await editor.locator("html.dracula").waitFor();
	await editor.locator(".tl-theme__dark").waitFor();
	assert.equal(
		await editor
			.locator(".tl-container")
			.evaluate((el) =>
				getComputedStyle(el).getPropertyValue("--tl-color-background").trim(),
			),
		"#282a36",
	);
	await selectTheme("alucard");
	await editor.locator("html.alucard").waitFor();
	await editor.locator(".tl-theme__light").waitFor();
	await selectTheme("host");
	await editor.locator("html.light").waitFor();
	await page.getByRole("button", { name: "Switch theme" }).click();
	await editor.locator("html.dark").waitFor();
	assert.equal(await web.locator("html").getAttribute("class"), webTheme);
	assert.deepEqual(
		await web.evaluate(() =>
			Object.fromEntries(
				Object.entries(localStorage).filter(
					([key]) => key === "theme" || key.startsWith("haunter-theme-"),
				),
			),
		),
		webPreferences,
	);
	console.log(
		"PASS: narrow navigation preserves the frame; named light/dark canvas themes and Follow host work without changing web preferences",
	);
	assert.deepEqual(errors, []);
} catch (error) {
	await page.screenshot({ path: `${output}/failure.png` });
	throw error;
} finally {
	await browser.close();
}
