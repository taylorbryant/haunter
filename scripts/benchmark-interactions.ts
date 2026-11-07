import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";

// Only use disposable preview:mcp-editor hosts. This creates 100 pages and 200
// tasks and edits them. Start separate --production previews for comparisons.
// bun scripts/benchmark-interactions.ts main=http://127.0.0.1:8787 pr=http://127.0.0.1:8788
type Fixture = {
	appOrigin: string;
	workspaceId: string;
	pageId: string;
};
type Data = {
	fixture: Fixture;
	bodyId: string;
	treeId: string;
	taskId: string;
};
type Flow = "body" | "task" | "tree";
type Sample = {
	variant: string;
	flow: Flow;
	warmup: boolean;
	frameMedianMs: number;
	frameP95Ms: number;
	mainThreadMs: number;
	scriptMs: number;
	contextPosts: number;
	contextBytes: number;
};
declare global {
	interface Window {
		__interactionFrames: number[];
	}
}

const variants = process.argv.slice(2).map((spec) => {
	const separator = spec.indexOf("=");
	assert.ok(separator > 0, "Expected label=http://preview-host:port");
	const host = spec.slice(separator + 1);
	assert.equal(new URL(host).hostname, "127.0.0.1", "Use a local preview host");
	return { label: spec.slice(0, separator), host };
});
assert.ok(variants.length > 0, "Pass at least one disposable preview host");
const samples = Number(process.env.BENCH_SAMPLES ?? 3);
assert.ok(Number.isInteger(samples) && samples > 0);
const profileDir = process.env.BENCH_PROFILE_DIR;
if (profileDir) await mkdir(profileDir, { recursive: true });
const typed = " Measured typing keeps the editor usable.";
const percentile = (values: number[], fraction: number) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[
		Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
	];
};
const browser = await chromium.launch({ headless: true });
const results: Sample[] = [];
const data = new Map<string, Data>();

async function setup(host: string) {
	const fixture: Fixture = await (await fetch(`${host}/fixture`)).json();
	const response = await fetch(`${host}/test/interaction-fixture`, {
		method: "POST",
	});
	assert.ok(response.ok, `Fixture request failed: ${response.status}`);
	return { fixture, ...(await response.json()) } as Data;
}

async function prepare(page: Page, value: Data, flow: Flow) {
	const { fixture } = value;
	const root = `${fixture.appOrigin}/w/${fixture.workspaceId}`;
	await page.goto(
		flow === "task" ? `${root}/tasks` : `${root}/p/${value.bodyId}`,
	);
	await page.waitForFunction(
		() => !document.body.textContent?.includes("Loading pages"),
	);
	if (flow === "task") {
		await page.locator("[data-task-id]").first().waitFor();
		while ((await page.locator("[data-task-id]").count()) < 200) {
			const previous = await page.locator("[data-task-id]").count();
			await page
				.getByRole("button", { name: "Load more", exact: true })
				.click();
			await page.waitForFunction(
				(count) => document.querySelectorAll("[data-task-id]").length > count,
				previous,
			);
		}
		const row = page.locator(`[data-task-id="${value.taskId}"]`);
		await row
			.getByRole("button", { name: /^Interaction task|^Measured task/ })
			.click();
		const input = page.getByRole("textbox", { name: "Task name", exact: true });
		await input.fill(`Measured task ${Date.now()}`);
		return input;
	}
	await page.locator(".bn-editor[contenteditable=true]").waitFor();
	await page.locator("[data-saved=true]").waitFor({ state: "attached" });
	if (flow === "tree") {
		const link = page.locator(
			`[data-sidebar=menu-button][href$="/p/${value.treeId}"]`,
		);
		const row = link.locator("xpath=..");
		await row
			.getByRole("button", { name: "Page actions", exact: true })
			.click();
		await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
		const input = page.getByRole("textbox", { name: "Page name", exact: true });
		await input.fill(`Measured page ${Date.now()}`);
		return input;
	}
	const paragraph = page.locator(".bn-editor .bn-inline-content").first();
	await paragraph.click();
	await page.keyboard.press("Home");
	return page.locator(".bn-editor[contenteditable=true]");
}

async function verify(
	context: BrowserContext,
	page: Page,
	value: Data,
	flow: Flow,
) {
	if (flow === "body") {
		// The fixture accumulates the same text across samples. Checking only for
		// that text could accept the warmup even if this sample's edits were lost.
		const expectedParagraph = await page
			.locator(".bn-editor .bn-inline-content")
			.first()
			.textContent();
		assert.ok(expectedParagraph?.includes(typed));
		await page.locator("[data-saved=true]").waitFor({ state: "attached" });
		await page.reload();
		await page.locator(".bn-editor[contenteditable=true]").waitFor();
		await page.waitForFunction(
			(text) =>
				document.querySelector(".bn-editor .bn-inline-content")?.textContent ===
				text,
			expectedParagraph,
		);
		return;
	}
	const id = flow === "task" ? value.taskId : value.treeId;
	const path = `/api/${flow === "task" ? "tasks" : "pages"}/${id}`;
	const expectedTitle = await page
		.getByRole("textbox", {
			name: flow === "task" ? "Task name" : "Page name",
			exact: true,
		})
		.inputValue();
	const saved = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === path &&
			response.request().method() === "PATCH",
	);
	await page.keyboard.press("Enter");
	assert.ok((await saved).ok());
	const response = await context.request.get(
		`${value.fixture.appOrigin}${flow === "task" ? `/api/workspaces/${value.fixture.workspaceId}/tasks?taskId=${id}` : path}`,
	);
	assert.ok(response.ok());
	const stored = await response.json();
	assert.equal(
		flow === "task" ? stored.items[0]?.title : stored.title,
		expectedTitle,
	);
}

try {
	console.log(
		JSON.stringify({
			kind: "conditions",
			browser: browser.version(),
			viewport: "1280x1000",
			cpu: 4,
			network: "local, unthrottled",
			samples,
			characters: typed.length,
			keyDelayMs: 80,
			pages: 103,
			tasks: 200,
			cache: "fresh context, hydrated interaction; excludes setup and save",
			metric: "beforeinput to second animation frame (lab proxy, not INP)",
		}),
	);
	for (const variant of variants)
		data.set(variant.label, await setup(variant.host));
	for (let i = 0; i <= samples; i++) {
		for (const variant of i % 2 ? [...variants].reverse() : variants) {
			const value = data.get(variant.label);
			assert.ok(value);
			for (const flow of ["body", "task", "tree"] as const) {
				const context = await browser.newContext({
					viewport: { width: 1280, height: 1000 },
				});
				try {
					await context.request.get(`${variant.host}/login`, {
						maxRedirects: 0,
					});
					const page = await context.newPage();
					page.setDefaultTimeout(30_000);
					const errors: string[] = [];
					page.on("pageerror", (error) => errors.push(error.message));
					const cdp = await context.newCDPSession(page);
					await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
					await cdp.send("Performance.enable");
					const input = await prepare(page, value, flow);
					await page.waitForTimeout(1500);
					let contextPosts = 0,
						contextBytes = 0;
					page.on("request", (request) => {
						if (
							request.method() === "POST" &&
							new URL(request.url()).pathname.includes("live-context")
						) {
							contextPosts++;
							contextBytes += request.postDataBuffer()?.length ?? 0;
						}
					});
					await input.evaluate((el) => {
						window.__interactionFrames = [];
						el.addEventListener("beforeinput", () => {
							const start = performance.now();
							requestAnimationFrame(() =>
								requestAnimationFrame(() =>
									window.__interactionFrames.push(performance.now() - start),
								),
							);
						});
					});
					if (profileDir && i === 0) {
						await cdp.send("Profiler.enable");
						await cdp.send("Profiler.start");
					}
					const before = (await cdp.send("Performance.getMetrics")).metrics;
					await input.pressSequentially(typed, { delay: 80 });
					await page.waitForTimeout(100);
					const after = (await cdp.send("Performance.getMetrics")).metrics;
					if (profileDir && i === 0) {
						const { profile } = await cdp.send("Profiler.stop");
						await Bun.write(
							`${profileDir}/${variant.label}-${flow}.cpuprofile`,
							JSON.stringify(profile),
						);
					}
					const frames = await page.evaluate(() => window.__interactionFrames);
					assert.equal(frames.length, typed.length);
					const delta = (name: string) =>
						((after.find((m) => m.name === name)?.value ?? 0) -
							(before.find((m) => m.name === name)?.value ?? 0)) *
						1000;
					await page.waitForTimeout(1200);
					const result = {
						variant: variant.label,
						flow,
						warmup: i === 0,
						frameMedianMs: percentile(frames, 0.5),
						frameP95Ms: percentile(frames, 0.95),
						mainThreadMs: delta("TaskDuration"),
						scriptMs: delta("ScriptDuration"),
						contextPosts,
						contextBytes,
					};
					await verify(context, page, value, flow);
					assert.deepEqual(errors, []);
					results.push(result);
					console.log(JSON.stringify({ kind: "sample", ...result }));
				} finally {
					await context.close();
				}
			}
		}
	}
	for (const variant of variants)
		for (const flow of ["body", "task", "tree"] as const) {
			const matching = results.filter(
				(sample) =>
					sample.variant === variant.label &&
					sample.flow === flow &&
					!sample.warmup,
			);
			const summary = Object.fromEntries(
				(
					[
						"frameMedianMs",
						"frameP95Ms",
						"mainThreadMs",
						"scriptMs",
						"contextPosts",
						"contextBytes",
					] as const
				).map((metric) => {
					const values = matching.map((sample) => sample[metric]);
					return [
						metric,
						{
							median: percentile(values, 0.5),
							min: Math.min(...values),
							max: Math.max(...values),
						},
					];
				}),
			);
			console.log(
				JSON.stringify({
					kind: "summary",
					variant: variant.label,
					flow,
					...summary,
				}),
			);
		}
} finally {
	await browser.close();
}
