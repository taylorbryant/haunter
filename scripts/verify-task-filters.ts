import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run against preview:mcp-editor's synthetic accounts and disposable database.
const fixture = await (await fetch("http://localhost:8797/fixture")).json();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 390, height: 844 },
	isMobile: true,
	hasTouch: true,
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const tasksUrl = `${fixture.appOrigin}/w/${fixture.workspaceId}/tasks`;
const status = (name: string, pressed?: boolean) =>
	page
		.getByRole("group", { name: "Task status", exact: true })
		.getByRole("button", { name, exact: true, pressed });
const scope = (name: string, pressed?: boolean) =>
	page
		.getByRole("group", { name: "Task assignee", exact: true })
		.getByRole("button", { name, exact: true, pressed });
const row = (id: string) => page.locator(`[data-task-id="${id}"]`);
const releaseRead = Promise.withResolvers<void>();
const readStarted = Promise.withResolvers<void>();
const releaseWrite = Promise.withResolvers<void>();
let holdRead = true;
let taskNavigations = 0;
const created: string[] = [];
try {
	await page.goto("http://127.0.0.1:8797/login");
	async function createTask(title: string, assigneeId?: null) {
		const response = await context.request.post(
			`${fixture.appOrigin}/api/tasks`,
			{
				data: { title, workspaceId: fixture.workspaceId, assigneeId },
			},
		);
		assert.equal(response.status(), 201, await response.text());
		const task = await response.json();
		created.push(task.id);
		return task.id as string;
	}
	const mine = await createTask(`Filter proof ${Date.now()}`);
	const unassigned = await createTask(`Unassigned proof ${Date.now()}`, null);
	const completed = await context.request.patch(
		`${fixture.appOrigin}/api/tasks/${mine}`,
		{
			data: { completed: true },
		},
	);
	assert.ok(completed.ok(), await completed.text());
	await page.goto(`${tasksUrl}?source=filter-proof#tasks`);
	await status("Open", true).waitFor();
	await row(unassigned).waitFor();
	const historyLength = await page.evaluate(() => history.length);

	await page.route("**/*", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (
			url.pathname === new URL(tasksUrl).pathname &&
			request.headers().rsc === "1"
		) {
			taskNavigations++;
			await route.abort();
			return;
		}
		if (
			holdRead &&
			url.pathname === `/api/workspaces/${fixture.workspaceId}/tasks` &&
			url.searchParams.get("filter") === "completed"
		) {
			readStarted.resolve();
			await releaseRead.promise;
		}
		await route.continue();
	});

	// Selection must change while the result request is still pending, with no RSC round trip.
	await status("Completed").tap();
	await status("Completed", true).waitFor({ timeout: 2_000 });
	await page.getByText("Loading tasks…", { exact: true }).waitFor();
	await readStarted.promise;
	assert.equal(taskNavigations, 0);
	assert.equal(new URL(page.url()).searchParams.get("filter"), "completed");
	holdRead = false;
	releaseRead.resolve();
	await row(mine).waitFor();
	assert.equal(await row(unassigned).count(), 0);
	await status("Open").tap();
	await status("Open", true).waitFor();
	await row(unassigned).waitFor();
	assert.equal(
		await page.getByText("Loading tasks…", { exact: true }).count(),
		0,
	);

	// Two changes in the same event turn must compose, even before React rerenders.
	await page.evaluate(() => {
		for (const label of ["All", "Mine"]) {
			const button = Array.from(
				document.querySelectorAll<HTMLButtonElement>("fieldset button"),
			).find((candidate) => candidate.textContent === label);
			if (!button) throw new Error(`Missing ${label} filter`);
			button.click();
		}
	});
	await status("All", true).waitFor();
	await scope("Mine", true).waitFor();
	await row(mine).waitFor();
	assert.equal(await row(unassigned).count(), 0);
	assert.equal(new URL(page.url()).searchParams.get("filter"), "all");
	assert.equal(new URL(page.url()).searchParams.get("scope"), "mine");
	assert.equal(new URL(page.url()).searchParams.get("source"), "filter-proof");
	assert.equal(new URL(page.url()).hash, "#tasks");
	assert.equal(await page.evaluate(() => history.length), historyLength);
	assert.equal(taskNavigations, 0);

	await page.reload();
	await status("All", true).waitFor();
	await scope("Mine", true).waitFor();
	await row(mine).waitFor();
	await page.goto(
		`${tasksUrl}?filter=all&scope=mine&taskId=${mine}&source=filter-proof#tasks`,
	);
	await row(mine).waitFor();
	await page.getByRole("button", { name: "Show all tasks", exact: true }).tap();
	await page
		.getByRole("button", { name: "Show all tasks", exact: true })
		.waitFor({ state: "hidden" });
	assert.equal(new URL(page.url()).searchParams.has("taskId"), false);
	await status("All", true).waitFor();
	await scope("Mine", true).waitFor();
	await status("Open").tap();
	await scope("Everyone").tap();
	await scope("Everyone", true).waitFor();
	await row(unassigned).waitFor();
	assert.equal(new URL(page.url()).search, "?source=filter-proof");
	assert.equal(taskNavigations, 0);

	// A filter click blurs an inline edit. Keep the editor mounted until its save settles.
	await status("All").tap();
	await row(mine)
		.getByRole("button", { name: /^Filter proof/ })
		.tap();
	const renamedTitle = `Saved while filtering ${Date.now()}`;
	await page
		.getByRole("textbox", { name: "Task name", exact: true })
		.fill(renamedTitle);
	await page.route(`**/api/tasks/${mine}`, async (route) => {
		if (route.request().method() === "PATCH") await releaseWrite.promise;
		await route.continue();
	});
	const pendingWrite = page.waitForRequest(
		(request) =>
			request.method() === "PATCH" &&
			request.url().endsWith(`/api/tasks/${mine}`),
	);
	await status("Open").tap();
	await pendingWrite;
	await status("Open", true).waitFor();
	assert.equal(await row(mine).count(), 0);
	const saved = page.waitForResponse(
		(response) =>
			response.request().method() === "PATCH" &&
			response.url().endsWith(`/api/tasks/${mine}`),
	);
	releaseWrite.resolve();
	assert.ok((await saved).ok());
	await status("Completed").tap();
	await row(mine)
		.getByRole("button", { name: renamedTitle, exact: true })
		.waitFor();
	assert.equal(taskNavigations, 0);
	await page.unrouteAll({ behavior: "wait" });

	await page.setViewportSize({ width: 1280, height: 1080 });
	await status("Completed").click();
	await scope("Mine").click();
	await row(mine).waitFor();
	await page.getByRole("link", { name: "Home", exact: true }).click();
	await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
	await page.goBack();
	await status("Completed", true).waitFor();
	await scope("Mine", true).waitFor();
	await row(mine).waitFor();
	await page.goForward();
	await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
	console.log(
		"PASS: mobile filters update before slow results without server navigation; cached results, rapid status/assignee changes, URL defaults/hash, focused tasks, pending edits, reload and back/forward all work",
	);
} finally {
	releaseRead.resolve();
	releaseWrite.resolve();
	await page.unrouteAll({ behavior: "wait" });
	for (const id of created) {
		await context.request.delete(`${fixture.appOrigin}/api/tasks/${id}`);
	}
	await browser.close();
}
