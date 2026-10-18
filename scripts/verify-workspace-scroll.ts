import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect as baseExpect, type Page } from "playwright/test";

// Run against preview:mcp-editor's synthetic account and disposable database.
const host = "http://127.0.0.1:8797";
const fixture = (await (await fetch(`${host}/fixture`)).json()) as {
	appOrigin: string;
	workspaceId: string;
};
const { pages } = (await (
	await fetch(`${host}/test/scroll-fixture`, { method: "POST" })
).json()) as { pages: { id: string; title: string }[] };
const [first, second] = pages;
assert.ok(first && second);
const output = "/private/tmp/haunter-workspace-scroll-proof";
await mkdir(output, { recursive: true });
const expect = baseExpect.configure({ timeout: 30_000 });
const browser = await chromium.launch({ headless: true });
const path = (id: string) => `/w/${fixture.workspaceId}/p/${id}`;
async function expectOffset(page: Page, top: number) {
	await expect
		.poll(
			async () => Math.abs((await page.evaluate(() => window.scrollY)) - top),
			{ message: `Document scrollY should be ${top} at ${page.url()}` },
		)
		.toBeLessThan(1);
}
async function setOffset(page: Page, top: number) {
	// A real user cannot scroll the page while the mobile drawer is closing.
	// Wait for its animation and scroll lock before setting a precise position.
	await page.locator('[data-slot="sidebar"][data-mobile="true"]').waitFor({
		state: "hidden",
	});
	await page.evaluate((top) => window.scrollTo(0, top), top);
	await expectOffset(page, top);
	// Let the browser deliver the scroll event before the next history action.
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
	);
}
async function ready(page: Page, target: { id: string; title: string }) {
	await expect(page).toHaveURL(new RegExp(`/p/${target.id}(?:[?#]|$)`));
	await expect(
		page.getByRole("textbox", { name: "Page title", exact: true }),
	).toHaveValue(target.title);
	await page
		.locator('.bn-block-outer[data-id="scroll-proof-99"]')
		.filter({ hasText: target.title })
		.waitFor();
}
async function navigate(page: Page, target: { id: string; title: string }) {
	if ((page.viewportSize()?.width ?? 1280) < 768)
		await page.locator("[data-slot=sidebar-trigger]").click();
	await page
		.locator(`a[href="${path(target.id)}"]`)
		.first()
		.click();
	await ready(page, target);
}
async function anchor(page: Page, hash: string) {
	await page.evaluate((hash) => {
		const link = document.createElement("a");
		link.href = hash;
		document.body.append(link);
		link.click();
		link.remove();
	}, hash);
}
async function expectAnchor(page: Page) {
	// Native scroll anchoring can shift a few pixels as editor styles settle.
	await expect
		.poll(() =>
			page.evaluate(() => {
				const target = document.getElementById("scroll-anchor");
				return target ? Math.abs(target.getBoundingClientRect().top) : Infinity;
			}),
		)
		.toBeLessThan(4);
	assert.ok(await page.evaluate(() => window.scrollY > 0));
}

try {
	const initial = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 1280, height: 900 },
	});
	try {
		await initial.request.get(`${host}/login`);
		const page = await initial.newPage();
		await page.goto(`${fixture.appOrigin}/w/${fixture.workspaceId}/home`);
		const sidebar = page.locator('[data-slot="sidebar-container"]');
		await expect(sidebar).toBeVisible();
		const bounds = await sidebar.boundingBox();
		assert.ok(bounds);
		assert.equal(bounds.y, 0);
		assert.equal(bounds.height, 900);
		assert.equal(
			await sidebar.evaluate((el) =>
				getComputedStyle(el).getPropertyValue("--session-banner-height").trim(),
			),
			"0px",
		);
		console.log("PASS: full-height sidebar before JavaScript runs");
	} finally {
		await initial.close();
	}
	for (const viewport of [
		{ width: 1280, height: 900 },
		{ width: 390, height: 844 },
	]) {
		const context = await browser.newContext({ viewport });
		context.setDefaultTimeout(30_000);
		// The editor has block IDs, not HTML fragment IDs. Add a native anchor
		// fixture outside ProseMirror's managed DOM once its real content arrives.
		await context.addInitScript(() => {
			const install = () => {
				const mark = () => {
					for (const editor of document.querySelectorAll(".bn-editor")) {
						const root = editor.closest(".mx-auto");
						if (
							!root ||
							!editor.querySelector('[data-id="scroll-proof-99"]') ||
							root.querySelector("#scroll-anchor")
						)
							continue;
						const target = document.createElement("section");
						target.id = "scroll-anchor";
						target.textContent = "Native fragment target";
						root.append(target);
						const tail = document.createElement("div");
						tail.style.height = "2000px";
						root.append(tail);
					}
				};
				new MutationObserver(mark).observe(document.documentElement, {
					childList: true,
					subtree: true,
				});
				mark();
			};
			if (document.documentElement) install();
			else
				document.addEventListener("DOMContentLoaded", install, { once: true });
		});
		await context.request.get(`${host}/login`);
		const page = await context.newPage();
		try {
			await page.goto(fixture.appOrigin + path(first.id));
			await ready(page, first);
			await setOffset(page, 1750);
			if (viewport.width < 768)
				await page.locator("[data-slot=sidebar-trigger]").click();
			await page.getByRole("link", { name: "Home", exact: true }).click();
			await page.waitForURL("**/home");
			await expectOffset(page, 0);
			await page.goBack();
			await ready(page, first);
			await expectOffset(page, 1750);
			await page.goForward();
			await page.waitForURL("**/home");
			await expectOffset(page, 0);
			await page.goBack();
			await ready(page, first);
			await expectOffset(page, 1750);
			console.log(
				`PASS ${viewport.width}px: long → short → Back/Forward restores both positions`,
			);

			await setOffset(page, 2300);
			await navigate(page, second);
			await expectOffset(page, 0);
			await setOffset(page, 1100);
			await navigate(page, first);
			await expectOffset(page, 0);
			await setOffset(page, 3100);
			await page.goBack();
			await ready(page, second);
			await expectOffset(page, 1100);
			await page.goBack();
			await ready(page, first);
			await expectOffset(page, 2300);
			await page.goForward();
			await ready(page, second);
			await expectOffset(page, 1100);
			await page.goForward();
			await ready(page, first);
			await expectOffset(page, 3100);
			console.log(
				`PASS ${viewport.width}px: repeated visits to the same URL retain separate history positions`,
			);

			const documentOrigin = await page.evaluate(() => performance.timeOrigin);
			await anchor(page, "#scroll-anchor");
			await expectAnchor(page);
			const anchorOffset = await page.evaluate(() => window.scrollY);
			await setOffset(page, anchorOffset + 200);
			await page.goBack();
			await expectOffset(page, 3100);
			await page.goForward();
			await expectOffset(page, anchorOffset + 200);
			assert.equal(
				await page.evaluate(() => performance.timeOrigin),
				documentOrigin,
				"hash traversal must not reload the document",
			);
			await anchor(page, "#top");
			await expectOffset(page, 0);
			await page.goBack();
			await expectOffset(page, anchorOffset + 200);
			await anchor(page, "#");
			await expectOffset(page, 0);
			console.log(
				`PASS ${viewport.width}px: native anchors, #top, and hash history preserve manual scrolling without reloading`,
			);

			await page.goto(`${fixture.appOrigin}${path(second.id)}`);
			await ready(page, second);
			await anchor(page, "#scroll-anchor");
			await expectAnchor(page);
			await setOffset(page, 2100);
			await page.evaluate(() =>
				window.history.replaceState(
					null,
					"",
					`${window.location.pathname}?filter=a%20b${window.location.hash}`,
				),
			);
			await expect(page).toHaveURL(/\?filter=a%20b#scroll-anchor$/);
			await expectOffset(page, 2100);
			console.log(
				`PASS ${viewport.width}px: filter replacement preserves the document position`,
			);
			await anchor(page, "#missing-anchor");
			await setOffset(page, 2600);
			await page.mouse.move(viewport.width - 50, viewport.height / 2);
			await page.mouse.wheel(0, 500);
			await expect
				.poll(() => page.evaluate(() => window.scrollY))
				.toBeGreaterThan(2600);
			console.log(
				`PASS ${viewport.width}px: missing anchors do not lock user scrolling`,
			);

			await setOffset(page, 0);
			await page.route("**/api/auth/get-session?**", (route) =>
				route.fulfill({ status: 401, json: null }),
			);
			await page.evaluate(() => window.dispatchEvent(new Event("online")));
			const banner = page
				.getByRole("status")
				.filter({ hasText: "Your session expired" });
			await expect(banner).toBeVisible();
			const header = page.locator('[data-slot="sidebar-inset"] > header');
			const expectBannerLayout = async () => {
				await expect
					.poll(async () => {
						const bannerBounds = await banner.boundingBox();
						const headerBounds = await header.boundingBox();
						return bannerBounds && headerBounds
							? Math.abs(headerBounds.y - bannerBounds.height)
							: Infinity;
					})
					.toBeLessThan(1);
			};
			await expectBannerLayout();
			if (viewport.width >= 768) {
				const bounds = await page
					.locator('[data-slot="sidebar-container"]')
					.boundingBox();
				const bannerBounds = await banner.boundingBox();
				assert.ok(bounds && bannerBounds);
				assert.equal(bounds.y, bannerBounds.height);
				assert.equal(bounds.height, viewport.height - bannerBounds.height);
			}
			const originalHeight = (await banner.boundingBox())?.height ?? 0;
			await page.setViewportSize({ width: 320, height: viewport.height });
			await expectBannerLayout();
			const narrowHeight = (await banner.boundingBox())?.height ?? 0;
			assert.ok(
				viewport.width >= 768
					? narrowHeight > originalHeight
					: narrowHeight >= originalHeight,
			);
			await page.setViewportSize(viewport);
			await page.unroute("**/api/auth/get-session?**");
			await page.evaluate(() => window.dispatchEvent(new Event("online")));
			await expect(banner).toHaveCount(0);
			await expect.poll(async () => (await header.boundingBox())?.y).toBe(0);
			console.log(
				`PASS ${viewport.width}px: measured banner wrapping and recovery update layout`,
			);
			await page.screenshot({ path: `${output}/${viewport.width}.png` });
		} catch (error) {
			await page.screenshot({
				path: `${output}/${viewport.width}-failure.png`,
			});
			throw error;
		} finally {
			await context.close();
		}
	}
} finally {
	await browser.close();
}
