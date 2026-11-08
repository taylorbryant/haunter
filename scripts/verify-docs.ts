import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { CHANGELOG_RELEASES } from "../features/changelog/releases";
import { HELP_GUIDES } from "../features/help/guides";

// Use preview:mcp-editor's disposable fixture, never a production account.
const host = new URL(process.argv[2] ?? "http://127.0.0.1:8797");
assert.ok(["127.0.0.1", "localhost"].includes(host.hostname));
const fixture = await (await fetch(new URL("/fixture", host))).json();
const origin = fixture.appOrigin as string;
const screenshots = process.env.DOCS_SCREENSHOTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
	for (const width of [320, 390, 768, 1440]) {
		const context = await browser.newContext({
			viewport: { width, height: 1000 },
		});
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		for (const [path, section, imageName] of [
			["/guides", "Handbook", "handbook"],
			["/guides/pages", "Handbook", "handbook-article"],
			["/changelog", "Changelog", "changelog"],
		]) {
			assert.equal((await page.goto(`${origin}${path}`))?.status(), 200);
			await page.getByRole("heading", { level: 1 }).waitFor();
			await page.evaluate(() => document.fonts.ready);
			assert.equal(
				await page.evaluate(
					() => document.documentElement.scrollWidth > innerWidth,
				),
				false,
				`${path} overflows at ${width}px`,
			);
			const header = page.getByRole("banner");
			const headerBox = await header.boundingBox();
			assert.ok(headerBox);
			assert.equal(
				await header
					.getByRole("link", { name: section, exact: true })
					.getAttribute("aria-current"),
				"page",
			);
			await page
				.getByRole("link", { name: "Skip to content", exact: true })
				.focus();
			await page.keyboard.press("Enter");
			const headingBox = await page
				.getByRole("heading", { level: 1 })
				.boundingBox();
			assert.ok(
				headingBox && headingBox.y >= headerBox.height,
				"Skip link must keep the heading visible",
			);
			await page.goto(`${origin}${path}`);
			await page.evaluate(() => document.fonts.ready);
			if (screenshots && (width === 390 || width === 1440)) {
				await page.screenshot({
					path: join(
						screenshots,
						`${imageName}-${width === 390 ? "mobile" : "desktop"}.jpg`,
					),
					type: "jpeg",
					quality: 85,
					fullPage: path !== "/guides/pages",
				});
			}
		}
		const releases = page.locator("details");
		assert.equal(await releases.count(), CHANGELOG_RELEASES.length - 1);
		assert.equal(await page.locator("details[open]").count(), 0);
		const older = releases.first();
		const summary = older.locator("summary");
		await summary.focus();
		await page.keyboard.press("Enter");
		assert.equal(
			await older.evaluate((element) => (element as HTMLDetailsElement).open),
			true,
		);
		assert.equal(await older.locator("li").first().isVisible(), true);
		await page.keyboard.press("Enter");
		assert.equal(await older.locator("li").first().isVisible(), false);
		await page
			.getByRole("banner")
			.getByRole("link", { name: "Handbook", exact: true })
			.click();
		await page.waitForURL("**/guides");
		assert.equal(
			await page
				.getByRole("navigation", { name: "Handbook topics", exact: true })
				.getByRole("link")
				.count(),
			HELP_GUIDES.length,
		);
		await page.getByRole("link", { name: /^Getting started/ }).click();
		await page.waitForURL("**/guides/getting-started");
		const contents = page.getByRole("navigation", {
			name: "On this page",
			exact: true,
		});
		await contents.locator("summary").focus();
		await page.keyboard.press("Enter");
		const firstSection = contents.getByRole("link").first();
		const anchor = await firstSection.getAttribute("href");
		assert.ok(anchor);
		await firstSection.click();
		await page.waitForURL((url) => url.hash === anchor);
		const anchorBox = await page.locator(anchor).boundingBox();
		const bannerBox = await page.getByRole("banner").boundingBox();
		assert.ok(
			anchorBox && bannerBox && anchorBox.y >= bannerBox.height,
			"Section anchor must clear the sticky header",
		);
		await page
			.getByRole("navigation", { name: "Continue reading" })
			.getByRole("link")
			.click();
		await page.waitForURL("**/guides/pages");
		if (width < 1024) {
			await page.getByText("All topics", { exact: true }).click();
			await page
				.getByRole("navigation", {
					name: "Mobile Handbook topics",
					exact: true,
				})
				.getByRole("link", { name: "Tasks", exact: true })
				.click();
			await page.waitForURL("**/guides/tasks");
			await page
				.getByRole("navigation", {
					name: "Mobile Handbook topics",
					exact: true,
				})
				.waitFor({ state: "hidden" });
		}
		assert.deepEqual(errors, []);
		await context.close();
		console.log(
			`Handbook and changelog: ${width}px layout, keyboard navigation, anchors, and release disclosures passed.`,
		);
	}
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	for (const guide of HELP_GUIDES) {
		assert.equal(
			(await context.request.get(`${origin}/guides/${guide.slug}`)).status(),
			200,
		);
	}
	await page.goto(`${origin}/guides`);
	await page.getByRole("link", { name: /^Pages and notes/ }).click();
	await page.waitForURL("**/guides/pages");
	await page
		.getByRole("navigation", { name: "On this page", exact: true })
		.locator("summary")
		.click();
	await page
		.getByRole("navigation", { name: "On this page", exact: true })
		.getByRole("link")
		.first()
		.click();
	assert.ok(new URL(page.url()).hash);
	const imageLink = page
		.getByRole("link", { name: /^Open full-size screenshot/ })
		.first();
	const imageUrl = await imageLink.getAttribute("href");
	assert.ok(imageUrl);
	assert.equal(
		(await context.request.get(`${origin}${imageUrl}`)).status(),
		200,
	);
	await page
		.getByRole("banner")
		.getByRole("link", { name: "Changelog", exact: true })
		.click();
	await page.waitForURL("**/changelog");
	const firstRelease = page.locator("details").first();
	await firstRelease.locator("summary").click();
	assert.equal(await firstRelease.locator("li").first().isVisible(), true);
	const app = await context.request.get(origin, { maxRedirects: 0 });
	assert.equal(app.status(), 307);
	assert.equal(new URL(app.headers().location, origin).pathname, "/sign-in");
	assert.equal(
		await page
			.getByRole("banner")
			.getByRole("link", { name: "Open Haunter", exact: true })
			.getAttribute("href"),
		"/",
	);
	await context.close();
	console.log(
		"All chapters, full-size images, no-JavaScript navigation, and protected app entry passed.",
	);
} finally {
	await browser.close();
}
