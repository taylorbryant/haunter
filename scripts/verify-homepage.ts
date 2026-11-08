import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { HELP_GUIDES } from "../features/help/guides";
import { THEME_STORAGE_KEYS } from "../lib/themes";

// Use preview:mcp-editor's disposable account, never a production login.
const host = new URL(process.argv[2] ?? "http://127.0.0.1:8797");
assert.ok(["127.0.0.1", "localhost"].includes(host.hostname));
const fixture = await (await fetch(new URL("/fixture", host))).json();
const origin = fixture.appOrigin as string;
const screenshotDirectory = process.env.HOMEPAGE_SCREENSHOTS;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
	for (const width of [320, 390, 768, 1440]) {
		const context = await browser.newContext({
			viewport: { width, height: width >= 1024 ? 1050 : 844 },
		});
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const response = await page.goto(origin);
		assert.equal(response?.status(), 200);
		await page.getByRole("heading", { level: 1 }).waitFor();
		await page.evaluate(() => document.fonts.ready);
		await page.locator("#product-preview img").evaluate(async (element) => {
			await (element as HTMLImageElement).decode();
		});
		assert.equal(
			await page.evaluate(
				() => document.documentElement.scrollWidth > innerWidth,
			),
			false,
			`Horizontal overflow at ${width}px`,
		);
		if (screenshotDirectory && (width === 390 || width === 1440)) {
			await page.screenshot({
				path: join(
					screenshotDirectory,
					`homepage-${width === 390 ? "mobile" : "desktop"}.jpg`,
				),
				fullPage: true,
				type: "jpeg",
				quality: 85,
			});
		}
		// The screenshot controls work with a keyboard and expose their selection.
		for (const label of ["Tasks", "Canvases", "Pages"]) {
			const button = page.getByRole("button", { name: label, exact: true });
			await button.focus();
			await page.keyboard.press("Enter");
			assert.equal(await button.getAttribute("aria-pressed"), "true");
			await page.locator("#product-preview img").evaluate(async (element) => {
				await (element as HTMLImageElement).decode();
			});
		}
		// Each product example leads directly to its Handbook chapter.
		await page.getByRole("link", { name: "Pages in the Handbook" }).click();
		await page.waitForURL("**/guides/pages");
		for (const [path, active] of [
			["/", "Overview"],
			["/guides", "Handbook"],
			["/guides/pages", "Handbook"],
			["/changelog", "Changelog"],
		]) {
			await page.goto(`${origin}${path}`);
			await page.getByRole("heading", { level: 1 }).waitFor();
			await page
				.getByRole("link", { name: "Skip to content", exact: true })
				.focus();
			await page.keyboard.press("Enter");
			const headingBox = await page
				.getByRole("heading", { level: 1 })
				.boundingBox();
			assert.ok(
				headingBox && headingBox.y >= 80,
				"Skip link must keep the heading below the sticky header",
			);
			await page.goto(`${origin}${path}`);
			assert.equal(
				await page.evaluate(
					() => document.documentElement.scrollWidth > innerWidth,
				),
				false,
				`Horizontal overflow on ${path} at ${width}px`,
			);
			const siteNavigation = page.getByRole("navigation", {
				name: width < 1024 ? "Mobile" : "Site",
				exact: true,
			});
			if (width < 1024) {
				const menu = page.getByRole("banner").locator("summary");
				await menu.focus();
				await page.keyboard.press("Enter");
				await siteNavigation.waitFor({ state: "visible" });
				const link = siteNavigation.getByRole("link", {
					name: active,
					exact: true,
				});
				assert.equal(await link.getAttribute("aria-current"), "page");
				await link.focus();
				await page.keyboard.press("Escape");
				assert.equal(await siteNavigation.isVisible(), false);
				assert.equal(
					await menu.evaluate((element) => element === document.activeElement),
					true,
				);
				await page.keyboard.press("Enter");
				await siteNavigation
					.getByRole("link", { name: "Handbook", exact: true })
					.click();
				await page.waitForURL("**/guides");
				await siteNavigation.waitFor({ state: "hidden" });
				await page.goto(`${origin}${path}`);
			} else {
				assert.equal(
					await siteNavigation
						.getByRole("link", { name: active, exact: true })
						.getAttribute("aria-current"),
					"page",
				);
			}
			assert.equal(
				await page
					.getByRole("navigation", { name: "Footer", exact: true })
					.getByRole("link", { name: "Handbook", exact: true })
					.getAttribute("href"),
				"/guides",
			);
			if (
				path === "/guides" &&
				screenshotDirectory &&
				(width === 390 || width === 1440)
			) {
				await page.evaluate(() => document.fonts.ready);
				await page.screenshot({
					path: join(
						screenshotDirectory,
						`handbook-${width === 390 ? "mobile" : "desktop"}.jpg`,
					),
					fullPage: true,
					type: "jpeg",
					quality: 85,
				});
			}
		}
		await page.goto(`${origin}/guides`);
		await page
			.getByRole("link", { name: /Start here Your first few minutes/ })
			.click();
		await page.waitForURL("**/guides/getting-started");
		if (width < 640)
			await page
				.getByRole("navigation", { name: "On this page", exact: true })
				.locator("summary")
				.click();
		const firstSection = page
			.getByRole("navigation", { name: "On this page", exact: true })
			.getByRole("link")
			.filter({ visible: true })
			.first();
		const sectionId = await firstSection.getAttribute("href");
		assert.ok(sectionId);
		await firstSection.click();
		await page.waitForURL((url) => url.hash === sectionId);
		const section = page.locator(sectionId);
		const sectionBox = await section.boundingBox();
		assert.ok(
			sectionBox && sectionBox.y >= 80,
			"Sticky header must not obscure chapter anchors",
		);
		await page
			.getByRole("navigation", { name: "Continue reading" })
			.getByRole("link")
			.click();
		await page.waitForURL("**/guides/pages");
		if (width < 1024) {
			await page.getByText("Browse the Handbook", { exact: true }).click();
			await page
				.getByRole("navigation", {
					name: "Mobile Handbook chapters",
					exact: true,
				})
				.getByRole("link", { name: "Tasks", exact: true })
				.click();
			await page.waitForURL("**/guides/tasks");
			await page
				.getByRole("navigation", {
					name: "Mobile Handbook chapters",
					exact: true,
				})
				.waitFor({ state: "hidden" });
		}
		await page.goto(origin);
		await page
			.getByRole("link", { name: "Request access", exact: true })
			.click();
		await page.waitForURL("**/sign-up");
		await page.getByText("Request access", { exact: true }).waitFor();
		await page.locator('input[type="email"]').waitFor();
		assert.deepEqual(errors, []);
		await context.close();
		console.log(
			`Public website: ${width}px layout, preview controls, site/Handbook navigation, anchors, and request-access handoff passed.`,
		);
	}

	const context = await browser.newContext();
	for (const path of ["/app", `/w/${fixture.workspaceId}/home`]) {
		const response = await context.request.get(`${origin}${path}`, {
			maxRedirects: 0,
		});
		assert.equal(response.status(), 307);
		const location = new URL(response.headers().location, origin);
		assert.equal(location.pathname, "/sign-in");
		assert.equal(location.searchParams.get("next"), path);
	}
	const page = await context.newPage();
	await page.goto(origin);
	const destinations = await page
		.locator('a[href^="/"]')
		.evaluateAll((links) => [
			...new Set(links.map((link) => link.getAttribute("href") as string)),
		]);
	for (const path of new Set([
		...destinations.filter((path) => path !== "/app"),
		...HELP_GUIDES.map((guide) => `/guides/${guide.slug}`),
	])) {
		assert.equal(
			(await context.request.get(`${origin}${path}`)).status(),
			200,
			`Broken public link: ${path}`,
		);
	}
	const manifest = await (
		await context.request.get(`${origin}/manifest.webmanifest`)
	).json();
	assert.equal(manifest.start_url, "/app");
	assert.equal(manifest.id, "/");

	// A stale cookie still reaches the authenticated layout and returns to sign-in.
	await context.addCookies([
		{ name: "better-auth.session_token", value: "expired", url: origin },
	]);
	await page.goto(`${origin}/app`);
	await page.waitForURL("**/sign-in?next=*");
	assert.equal(new URL(page.url()).searchParams.get("next"), "/app");
	await context.clearCookies();
	await context.request.get(new URL("/login", host).href);
	await page.goto(origin);
	await page.evaluate((keys) => {
		localStorage.setItem(keys.mode, "light");
		localStorage.setItem(keys.lightTheme, "light");
	}, THEME_STORAGE_KEYS);
	await page.reload();
	await page.waitForFunction(() =>
		document.documentElement.classList.contains("dracula"),
	);
	await page
		.locator("header")
		.getByRole("link", { name: "Open Haunter", exact: true })
		.click();
	await page.waitForURL(`**/w/${fixture.workspaceId}/home`);
	await page.waitForFunction(() =>
		document.documentElement.classList.contains("light"),
	);
	await page.goto(origin);
	await page.getByRole("heading", { level: 1 }).waitFor();
	assert.equal(new URL(page.url()).pathname, "/");
	await context.close();
	console.log(
		"Public links, PWA entry, signed-out/stale-session redirects, and signed-in workspace entry passed.",
	);

	const noScript = await browser.newContext({ javaScriptEnabled: false });
	const staticPage = await noScript.newPage();
	assert.equal((await staticPage.goto(origin))?.status(), 200);
	await staticPage.getByRole("heading", { level: 1 }).waitFor();
	await staticPage
		.getByRole("banner")
		.getByRole("navigation", { name: "Site", exact: true })
		.getByRole("link", { name: "Handbook", exact: true })
		.click();
	assert.equal(new URL(staticPage.url()).pathname, "/guides");
	await staticPage
		.getByRole("link", { name: /Start here Your first few minutes/ })
		.click();
	assert.equal(new URL(staticPage.url()).pathname, "/guides/getting-started");
	await staticPage.goto(origin);
	await staticPage
		.getByRole("link", { name: "Request access", exact: true })
		.click();
	assert.equal(new URL(staticPage.url()).pathname, "/sign-up");
	await noScript.close();
	console.log(
		"Homepage, Handbook, and request-access links work without JavaScript.",
	);
} finally {
	await browser.close();
}
