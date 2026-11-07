import assert from "node:assert/strict";
import { chromium } from "playwright";

type Timing = {
	start: number;
	path: string;
	visible: number;
	title: number;
	body: number;
	bodyFrames: number;
};
declare global {
	interface Window {
		__haunterCreationTiming: Timing;
	}
}
type Sample = {
	kind: "sample";
	variant: string;
	mobile: boolean;
	flow: string;
	warmup: boolean;
	visibleMs: number;
	titleMs: number;
	editorMs: number;
};
// Use disposable preview:mcp-editor hosts only. Each run creates and edits pages.
// Example: bun scripts/benchmark-page-creation.ts main=http://127.0.0.1:8788 pr=http://127.0.0.1:8789

const variants = (
	process.argv.length > 2
		? process.argv.slice(2)
		: ["current=http://127.0.0.1:8797"]
).map((spec) => {
	const separator = spec.indexOf("=");
	assert.ok(separator > 0, "Expected label=http://preview-host:port");
	return { label: spec.slice(0, separator), host: spec.slice(separator + 1) };
});
const samples = Number(process.env.BENCH_SAMPLES ?? 3);
assert.ok(
	Number.isInteger(samples) && samples > 0,
	"BENCH_SAMPLES must be a positive integer",
);
const apiDelay = 500,
	scriptDelay = 150;
const browser = await chromium.launch({ headless: true });
const results: Sample[] = [];
try {
	console.log(
		JSON.stringify({
			kind: "conditions",
			browser: browser.version(),
			mode: "matches preview host; use --production for comparisons",
			apiDelay,
			scriptDelay,
			cpu: 1,
			samples,
			cache:
				"fresh browser context per sample; slash source page loads editor first",
		}),
	);
	for (const mobile of [false, true])
		for (const flow of ["new", "slash"])
			for (const variant of mobile ? [...variants].reverse() : variants) {
				const host = variant.host;
				const fixture = await (await fetch(`${host}/fixture`)).json();
				const root = `${fixture.appOrigin}/w/${fixture.workspaceId}`;
				for (let i = 0; i <= samples; i++) {
					const context = await browser.newContext({
						viewport: mobile
							? { width: 390, height: 844 }
							: { width: 1280, height: 1000 },
						isMobile: mobile,
						hasTouch: mobile,
					});
					const page = await context.newPage();
					page.setDefaultTimeout(30000);
					const errors: string[] = [];
					page.on("pageerror", (error) => errors.push(error.message));
					await page.route("**/*", async (route) => {
						const request = route.request(),
							url = new URL(request.url());
						const delay =
							request.resourceType() === "script"
								? scriptDelay
								: (url.pathname === "/api/pages" &&
											request.method() === "POST") ||
										url.pathname.endsWith("/document-session") ||
										(url.pathname.includes("/p/") &&
											url.searchParams.has("_rsc"))
									? apiDelay
									: 0;
						if (delay) {
							const response = await route.fetch();
							await new Promise((r) => setTimeout(r, delay));
							await route.fulfill({ response });
						} else await route.continue();
					});
					await context.request.get(`${host}/login`, { maxRedirects: 0 });
					let parentId: string | null = null;
					if (flow === "new") {
						await page.goto(`${root}/home`);
						await page
							.getByRole("heading", { name: "Home", exact: true })
							.waitFor();
						await page.waitForFunction(
							() => !document.body.textContent?.includes("Loading pages"),
						);
						if (mobile)
							await page
								.locator("main")
								.getByRole("button", { name: "Toggle Sidebar", exact: true })
								.click();
					} else {
						const response = await context.request.post(
							`${fixture.appOrigin}/api/pages`,
							{
								data: {
									workspaceId: fixture.workspaceId,
									title: "Timing parent",
									initialContent: [
										{
											id: crypto.randomUUID(),
											type: "paragraph",
											props: {},
											content: [
												{
													type: "text",
													text: "Disposable parent.",
													styles: {},
												},
											],
											children: [],
										},
									],
								},
							},
						);
						assert.equal(response.status(), 201);
						parentId = (await response.json()).id;
						await page.goto(`${root}/p/${parentId}`);
						const editor = page.locator(".bn-editor[contenteditable=true]");
						await editor.waitFor();
						await page
							.locator("[data-saved=true]")
							.waitFor({ state: "attached" });
						await page.waitForFunction(
							() => !document.body.textContent?.includes("Loading pages"),
						);
						await editor.evaluate((el) => {
							el.focus();
							const range = document.createRange();
							range.selectNodeContents(
								el.querySelector(".bn-inline-content:last-child") ?? el,
							);
							range.collapse(false);
							const selection = window.getSelection();
							selection?.removeAllRanges();
							selection?.addRange(range);
						});
						await editor.press("End");
						await editor.press("Enter");
						await editor.pressSequentially("/page");
					}
					const button =
						flow === "new"
							? page.getByRole("button", { name: "New page", exact: true })
							: page.getByRole("option", { name: /^Page/ }).first();
					await button.waitFor();
					await button.evaluate((el) =>
						el.addEventListener(
							"click",
							() => {
								const state = {
									start: performance.now(),
									path: location.pathname,
									visible: 0,
									title: 0,
									body: 0,
									bodyFrames: 0,
								};
								window.__haunterCreationTiming = state;
								const observe = () => {
									const title = document.querySelector<HTMLTextAreaElement>(
										'[aria-label="Page title"]',
									);
									if (location.pathname !== state.path && title?.value === "") {
										const elapsed = performance.now() - state.start;
										if (!state.visible) state.visible = elapsed;
										if (!state.title && !title.readOnly) state.title = elapsed;
										if (
											!state.body &&
											document.querySelector(".bn-editor[contenteditable=true]")
										) {
											if (++state.bodyFrames >= 2) state.body = elapsed;
										}
									}
									if (!state.title || !state.body)
										requestAnimationFrame(observe);
								};
								requestAnimationFrame(observe);
							},
							{ once: true, capture: true },
						),
					);
					const createdResponse = page.waitForResponse(
						(r) =>
							r.request().method() === "POST" &&
							new URL(r.url()).pathname === "/api/pages",
					);
					await button.click();
					const created = await (await createdResponse).json();
					assert.equal(created.parentPageId, parentId);
					await page.waitForFunction(() => {
						const s = window.__haunterCreationTiming;
						return s?.title && s.body;
					});
					const timing = await page.evaluate(() => {
						const s = window.__haunterCreationTiming;
						return {
							visibleMs: Math.round(s.visible),
							titleMs: Math.round(s.title),
							editorMs: Math.round(s.body),
						};
					});
					const row: Sample = {
						kind: "sample",
						variant: variant.label,
						mobile,
						flow,
						warmup: i === 0,
						...timing,
					};
					results.push(row);
					console.log(JSON.stringify(row));
					const title = `Timing ${variant.label} ${flow} ${i}`,
						marker = `Persisted ${crypto.randomUUID()}`;
					await page
						.getByRole("textbox", { name: "Page title", exact: true })
						.fill(title);
					await page.locator(".bn-editor[contenteditable=true]").fill(marker);
					await page.waitForFunction(
						async ({ id, title, marker, parentId }) => {
							const child = await (await fetch(`/api/pages/${id}`)).json();
							if (
								child.title !== title ||
								!JSON.stringify(child.content).includes(marker)
							)
								return false;
							if (!parentId) return true;
							const parent = await (
								await fetch(`/api/pages/${parentId}`)
							).json();
							return parent.content.some(
								(b: { type: string; props?: { pageId?: string } }) =>
									b.type === "pageLink" && b.props?.pageId === id,
							);
						},
						{ id: created.id, title, marker, parentId },
						{ polling: 100 },
					);
					await page.reload();
					await page.locator(".bn-editor[contenteditable=true]").waitFor();
					await page.waitForFunction(
						({ title, marker }) =>
							(
								document.querySelector(
									'[aria-label="Page title"]',
								) as HTMLTextAreaElement
							)?.value === title &&
							document
								.querySelector(".bn-editor[contenteditable=true]")
								?.textContent?.includes(marker),
						{ title, marker },
					);
					assert.deepEqual(errors, []);
					await context.close();
				}
			}
	for (const mobile of [false, true])
		for (const flow of ["new", "slash"])
			for (const v of variants) {
				const rows = results.filter(
					(r) =>
						r.variant === v.label &&
						r.mobile === mobile &&
						r.flow === flow &&
						!r.warmup,
				);
				const stat = (key: "titleMs" | "editorMs" | "visibleMs") => {
					const sorted = rows.map((r) => r[key]).sort((a, b) => a - b);
					return {
						median: sorted[Math.floor(sorted.length / 2)],
						range: [sorted[0], sorted.at(-1)],
					};
				};
				console.log(
					JSON.stringify({
						kind: "summary",
						variant: v.label,
						mobile,
						flow,
						title: stat("titleMs"),
						body: stat("editorMs"),
						visible: stat("visibleMs"),
						samples: rows.length,
						persistence: "verified after reload",
					}),
				);
			}
} finally {
	await browser.close();
}
