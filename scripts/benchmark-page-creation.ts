import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
	cache: string;
	flow: string;
	warmup: boolean;
	visibleMs: number;
	titleMs: number;
	editorMs: number;
	titleInputMs: number;
	bodyInputMs: number;
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
const cpu = Number(process.env.BENCH_CPU ?? 4);
const latency = Number(process.env.BENCH_LATENCY ?? 150);
const downloadThroughput =
	(Number(process.env.BENCH_DOWNLOAD_MBPS ?? 1.6) * 1_000_000) / 8;
const uploadThroughput =
	(Number(process.env.BENCH_UPLOAD_MBPS ?? 0.75) * 1_000_000) / 8;
const traceDir = process.env.BENCH_PROFILE_DIR;
const caches = (process.env.BENCH_CACHE ?? "cold,warm").split(",");
const viewports =
	process.env.BENCH_VIEWPORT === "desktop" ? [false] : [false, true];
const flows = (process.env.BENCH_FLOW ?? "new,slash").split(",");
assert.ok(
	Number.isFinite(downloadThroughput) && downloadThroughput > 0,
	"BENCH_DOWNLOAD_MBPS must be positive",
);
assert.ok(
	Number.isFinite(uploadThroughput) && uploadThroughput > 0,
	"BENCH_UPLOAD_MBPS must be positive",
);
assert.ok(Number.isFinite(cpu) && cpu >= 1, "BENCH_CPU must be at least 1");
assert.ok(
	Number.isFinite(latency) && latency >= 0,
	"BENCH_LATENCY must be nonnegative",
);
assert.ok(
	caches.every((c) => c === "cold" || c === "warm"),
	"Unknown cache mode",
);
assert.ok(
	flows.every((f) => f === "new" || f === "slash"),
	"Unknown creation flow",
);
const scenarios = viewports.flatMap((mobile) =>
	caches.flatMap((cache) => flows.map((flow) => ({ mobile, cache, flow }))),
);
if (traceDir) await mkdir(traceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results: Sample[] = [];
try {
	console.log(
		JSON.stringify({
			kind: "conditions",
			browser: browser.version(),
			mode: "matches preview host; use --production for comparisons",
			latency,
			downloadThroughput,
			uploadThroughput,
			cpu,
			samples,
			cache:
				"fresh context per sample; warm visits an editor before source navigation; slash always loads its source editor",
		}),
	);
	for (const { mobile, cache, flow } of scenarios)
		for (let i = 0; i <= samples; i++)
			for (const variant of i % 2 ? [...variants].reverse() : variants) {
				const host = variant.host;
				const fixture = await (await fetch(`${host}/fixture`)).json();
				const root = `${fixture.appOrigin}/w/${fixture.workspaceId}`;
				const context = await browser.newContext({
					ignoreHTTPSErrors: process.env.BENCH_ALLOW_SELF_SIGNED === "1",
					viewport: mobile
						? { width: 390, height: 844 }
						: { width: 1280, height: 1000 },
					isMobile: mobile,
					hasTouch: mobile,
				});
				const page = await context.newPage();
				page.setDefaultTimeout(60000);
				const cdp = await context.newCDPSession(page);
				await cdp.send("Network.enable");
				await cdp.send("Network.emulateNetworkConditions", {
					offline: false,
					latency,
					downloadThroughput,
					uploadThroughput,
				});
				await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
				const errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				await context.request.get(`${host}/login`, { maxRedirects: 0 });
				if (fixture.appOrigin.startsWith("https://")) {
					// The disposable login host is HTTP. Mirror only its synthetic
					// session into Better Auth's cookie name for an HTTPS app origin.
					const cookies = await context.cookies();
					await context.addCookies(
						cookies
							.filter((cookie) => cookie.name === "better-auth.session_token")
							.map((cookie) => ({
								...cookie,
								name: "__Secure-better-auth.session_token",
								secure: true,
							})),
					);
				}
				if (cache === "warm") {
					await page.goto(`${root}/p/${fixture.pageId}`);
					await page.locator(".bn-editor[contenteditable=true]").waitFor();
					await page
						.locator("[data-saved=true]")
						.waitFor({ state: "attached" });
				}
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
							.getByRole("button", {
								name: "Toggle Sidebar",
								exact: true,
							})
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
								if (
									location.pathname !== state.path &&
									title &&
									(state.visible || title.value === "")
								) {
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
								if (!state.title || !state.body) requestAnimationFrame(observe);
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
				const profile = !!traceDir && i === 0;
				if (profile) {
					await cdp.send("Profiler.enable");
					await cdp.send("Profiler.start");
				}
				await button.click();
				const created = await (await createdResponse).json();
				assert.equal(created.parentPageId, parentId);
				// Exercise each field as soon as it becomes writable. The first
				// character must be accepted before measuring the next surface.
				await page.waitForFunction(() => window.__haunterCreationTiming?.title);
				const titleInput = page.getByRole("textbox", {
					name: "Page title",
					exact: true,
				});
				await titleInput.pressSequentially("T");
				assert.equal(await titleInput.inputValue(), "T");
				const titleInputMs = await page.evaluate(() =>
					Math.round(performance.now() - window.__haunterCreationTiming.start),
				);
				await page.waitForFunction(() => window.__haunterCreationTiming?.body);
				const bodyInput = page.locator(".bn-editor[contenteditable=true]");
				await bodyInput.pressSequentially("P");
				assert.equal(await bodyInput.textContent(), "P");
				const bodyInputMs = await page.evaluate(() =>
					Math.round(performance.now() - window.__haunterCreationTiming.start),
				);
				await page.waitForFunction(() => {
					const s = window.__haunterCreationTiming;
					return s?.title && s.body;
				});
				if (profile) {
					const { profile: data } = await cdp.send("Profiler.stop");
					await Bun.write(
						`${traceDir}/${variant.label}-${mobile ? "mobile" : "desktop"}-${cache}-${flow}.cpuprofile`,
						JSON.stringify(data),
					);
				}
				const timing = await page.evaluate(() => {
					const s = window.__haunterCreationTiming;
					return {
						resources: performance
							.getEntriesByType("resource")
							.filter((r) => r.startTime >= s.start)
							.map((r) => {
								const e = r as PerformanceResourceTiming;
								return {
									path: new URL(e.name).pathname,
									rsc: new URL(e.name).searchParams.has("_rsc"),
									start: Math.round(e.startTime - s.start),
									end: Math.round(e.responseEnd - s.start),
									bytes: e.transferSize,
									protocol: e.nextHopProtocol,
								};
							}),
						visibleMs: Math.round(s.visible),
						titleMs: Math.round(s.title),
						editorMs: Math.round(s.body),
					};
				});
				const row: Sample = {
					kind: "sample",
					variant: variant.label,
					mobile,
					cache,
					flow,
					warmup: i === 0,
					...timing,
					titleInputMs,
					bodyInputMs,
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
						const parent = await (await fetch(`/api/pages/${parentId}`)).json();
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
						document.querySelector(".bn-editor[contenteditable=true]")
							?.textContent === marker,
					{ title, marker },
				);
				assert.deepEqual(errors, []);
				await page.close();
				// Keep visible sidebar size identical across samples and revisions.
				for (const id of [created.id, parentId].filter(Boolean)) {
					const deleted = await context.request.delete(
						`${fixture.appOrigin}/api/pages/${id}`,
					);
					assert.equal(deleted.status(), 204);
				}
				await context.close();
			}
	for (const { mobile, cache, flow } of scenarios)
		for (const v of variants) {
			const rows = results.filter(
				(r) =>
					r.variant === v.label &&
					r.mobile === mobile &&
					r.cache === cache &&
					r.flow === flow &&
					!r.warmup,
			);
			const stat = (
				key:
					| "titleMs"
					| "editorMs"
					| "visibleMs"
					| "titleInputMs"
					| "bodyInputMs",
			) => {
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
					cache,
					flow,
					title: stat("titleMs"),
					titleInput: stat("titleInputMs"),
					bodyInput: stat("bodyInputMs"),
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
