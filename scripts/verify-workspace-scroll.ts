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
const scrollArea = (page: Page) =>
	page.locator("[data-slot=sidebar-inset] > [data-app-scroll-root]");
async function expectOffset(page: Page, top: number) {
	await expect
		.poll(async () =>
			Math.abs((await scrollArea(page).evaluate((el) => el.scrollTop)) - top),
		)
		.toBeLessThan(1);
}
async function setOffset(page: Page, top: number) {
	// Model user scroll intent before setting an exact, repeatable position.
	await scrollArea(page).dispatchEvent("wheel", { deltaY: 1 });
	await scrollArea(page).evaluate((el, top) => el.scrollTo(0, top), top);
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
	await expect
		.poll(() =>
			page.evaluate(() => {
				const target = document.getElementById("scroll-anchor");
				const header = document.querySelector(
					"[data-slot=sidebar-inset] > header",
				);
				return target && header
					? Math.abs(
							target.getBoundingClientRect().top -
								header.getBoundingClientRect().bottom,
						)
					: Infinity;
			}),
		)
		.toBeLessThan(1);
	assert.equal(await page.evaluate(() => window.scrollY), 0);
}

try {
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
						tail.style.height = "1000px";
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
			const anchorOffset = await scrollArea(page).evaluate(
				(el) => el.scrollTop,
			);
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

			await page.goto(`${fixture.appOrigin}${path(second.id)}#scroll-anchor`);
			await ready(page, second);
			await expectAnchor(page);
			await setOffset(page, 2100);
			await page.reload();
			await ready(page, second);
			await expectOffset(page, 2100);
			await page.evaluate(() =>
				window.history.replaceState(
					null,
					"",
					`${window.location.pathname}?filter=a%20b${window.location.hash}`,
				),
			);
			await expect(scrollArea(page)).toHaveAttribute(
				"data-scroll-route",
				`${path(second.id)}?filter=a+b`,
			);
			await expectOffset(page, 2100);
			console.log(
				`PASS ${viewport.width}px: delayed initial anchor, reload restoration, and filter replacement`,
			);
			await anchor(page, "#missing-anchor");
			await scrollArea(page).dispatchEvent("wheel", { deltaY: 500 });
			await setOffset(page, 2600);
			await scrollArea(page).hover();
			await page.mouse.wheel(0, 500);
			await expect
				.poll(() => scrollArea(page).evaluate((el) => el.scrollTop))
				.toBeGreaterThan(2600);
			console.log(
				`PASS ${viewport.width}px: missing anchors do not lock user scrolling`,
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
