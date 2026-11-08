import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
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
		if (width < 1024) {
			const menu = page.locator("summary");
			await menu.focus();
			await page.keyboard.press("Enter");
			assert.equal(
				await page.getByRole("navigation", { name: "Mobile" }).isVisible(),
				true,
			);
			await page
				.getByRole("navigation", { name: "Mobile" })
				.getByRole("link", { name: "Made for AI, too" })
				.click();
			await page.waitForURL("**/#ai");
			assert.equal(new URL(page.url()).hash, "#ai");
		}
		await page
			.getByRole("link", { name: "Request access", exact: true })
			.click();
		await page.waitForURL("**/sign-up");
		await page.getByText("Request access", { exact: true }).waitFor();
		await page.locator('input[type="email"]').waitFor();
		assert.deepEqual(errors, []);
		await context.close();
		console.log(
			`Homepage: ${width}px layout, preview controls, navigation, and request-access handoff passed.`,
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
	for (const path of destinations.filter((path) => path !== "/app")) {
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
		.getByRole("link", { name: "Request access", exact: true })
		.click();
	assert.equal(new URL(staticPage.url()).pathname, "/sign-up");
	await noScript.close();
	console.log(
		"Homepage content and request-access link work without JavaScript.",
	);
} finally {
	await browser.close();
}
