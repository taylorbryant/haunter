import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run against preview:mcp-editor's disposable fixture. Pass the preview host as
// the first argument when using another port or a production-mode preview.
const host = process.argv[2] ?? "http://127.0.0.1:8797";
const fixture = await (await fetch(`${host}/fixture`)).json();
const root = `${fixture.appOrigin}/w/${fixture.workspaceId}`;
const browser = await chromium.launch({ headless: true });
try {
	for (const mobile of [false, true]) {
		const context = await browser.newContext({
			viewport: mobile
				? { width: 390, height: 844 }
				: { width: 1280, height: 1000 },
			isMobile: mobile,
			hasTouch: mobile,
		});
		const page = await context.newPage();
		page.setDefaultTimeout(15_000);
		await page.goto(`${host}/login`);
		await page.goto(`${root}/home`);
		await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
		await page.waitForFunction(
			() => !document.body.innerText.includes("Loading pages"),
		);
		const sidebar = async () => {
			if (mobile)
				await page
					.locator("main")
					.getByRole("button", { name: "Toggle Sidebar", exact: true })
					.click();
		};
		await sidebar();
		let creates = 0;
		const write = Promise.withResolvers<void>();
		const list = Promise.withResolvers<void>();
		let createdId = "";
		await page.route("**/api/pages", async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			creates++;
			await write.promise;
			const response = await route.fetch();
			createdId = (await response.json()).id;
			await route.fulfill({ response });
		});
		await page.route(
			`**/api/workspaces/${fixture.workspaceId}/pages`,
			async (route) => {
				await list.promise;
				await route.continue();
			},
		);
		// Same-turn clicks exercise the synchronous guard before React rerenders.
		await page
			.getByRole("button", { name: "New page", exact: true })
			.evaluate((button: HTMLButtonElement) => {
				button.click();
				button.click();
			});
		await page
			.getByRole("status")
			.filter({ hasText: "Creating page…" })
			.waitFor();
		assert.equal(
			await page
				.getByRole("button", { name: "New page", exact: true })
				.isDisabled(),
			true,
		);
		await page.waitForTimeout(200);
		assert.equal(creates, 1);
		write.resolve();
		try {
			// The title must appear while the sidebar refetch is still held.
			await page.waitForURL("**/p/*");
			await page
				.getByRole("textbox", { name: "Page title", exact: true })
				.waitFor();
			assert.ok(page.url().endsWith(`/p/${createdId}`));
			assert.equal(creates, 1);
			if (mobile)
				assert.equal(
					await page
						.getByRole("dialog", { name: "Sidebar", exact: true })
						.count(),
					0,
				);
		} finally {
			list.resolve();
		}
		await page.unrouteAll({ behavior: "wait" });
		await page.waitForFunction(
			() => !document.body.innerText.includes("Creating page…"),
		);

		// Failed creation releases the guard and keeps an actionable error visible.
		await sidebar();
		await page.route("**/api/pages", (route) =>
			route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({
					error: { code: "InternalError", message: "Creation unavailable" },
				}),
			}),
		);
		await page.getByRole("button", { name: "New page", exact: true }).click();
		await page.getByRole("alert").first().waitFor();
		await page.waitForFunction(
			() => !document.body.innerText.includes("Creating page…"),
		);
		assert.equal(
			await page
				.getByRole("button", { name: "New page", exact: true })
				.isEnabled(),
			true,
		);
		await page.unrouteAll({ behavior: "wait" });

		// Workspace navigation should show feedback before activation finishes,
		// and leave workspace content gated until the server confirms access.
		let activations = 0;
		const activation = Promise.withResolvers<void>();
		await page.route("**/api/auth/organization/set-active", async (route) => {
			activations++;
			await activation.promise;
			await route.continue();
		});
		await page
			.getByRole("button", { name: "Workspace: Editor proof", exact: true })
			.click();
		await page
			.getByRole(mobile ? "button" : "menuitem", {
				name: "Team workspace",
				exact: true,
			})
			.click();
		await page
			.getByRole("status")
			.filter({ hasText: "Switching workspace…" })
			.waitFor();
		assert.equal(
			await page
				.getByRole("textbox", { name: "Add a task", exact: true })
				.count(),
			0,
		);
		await page.waitForTimeout(300);
		assert.equal(activations, 1);
		activation.resolve();
		await page
			.getByRole("textbox", { name: "Add a task", exact: true })
			.waitFor();
		await page.waitForFunction(
			() => !document.body.innerText.includes("Loading pages"),
		);
		assert.equal(activations, 1);
		assert.ok(page.url().includes(`/w/${fixture.secondWorkspaceId}/home`));
		await page.unrouteAll({ behavior: "wait" });

		// Fail one activation. It must stop retrying until the user asks to retry.
		await page.route("**/api/auth/organization/set-active", async (route) => {
			activations++;
			await route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({ message: "Workspace unavailable" }),
			});
		});
		if (
			mobile &&
			!(await page
				.getByRole("dialog", { name: "Sidebar", exact: true })
				.count())
		)
			await sidebar();
		await page
			.getByRole("button", { name: "Workspace: Team workspace", exact: true })
			.click();
		await page
			.getByRole(mobile ? "button" : "menuitem", {
				name: "Editor proof",
				exact: true,
			})
			.click();
		await page.locator("main").getByRole("alert").waitFor();
		await page.waitForTimeout(800);
		assert.equal(activations, 2);
		await page.unrouteAll({ behavior: "wait" });
		if (
			mobile &&
			(await page.getByRole("dialog", { name: "Sidebar", exact: true }).count())
		)
			await page.keyboard.press("Escape");
		await page
			.locator("main")
			.getByRole("button", { name: "Try again", exact: true })
			.click();
		await page
			.getByRole("textbox", { name: "Add a task", exact: true })
			.waitFor();
		await page.waitForFunction(
			() => !document.body.innerText.includes("Loading pages"),
		);
		console.log(
			`PASS ${mobile ? "mobile" : "desktop"}: one page per repeated click, immediate pending feedback, navigation before list refetch, creation failure recovery, one workspace activation, gated content and explicit retry`,
		);
		await context.close();
	}
} finally {
	await browser.close();
}
