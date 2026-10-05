import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, expect as baseExpect } from "playwright/test";
import { normalizeCanvasSnapshot } from "@/features/canvases/lib/document";

// Only the disposable account/server started by preview-mcp-editor.ts.
const host = "http://localhost:8797";
const expect = baseExpect.configure({ timeout: 30000 });
const fixture = await (await fetch(`${host}/fixture`)).json();
const output = "/private/tmp/haunter-page-actions-proof";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	permissions: ["clipboard-read", "clipboard-write"],
	viewport: { width: 1280, height: 1100 },
});
context.setDefaultTimeout(30000);
const page = await context.newPage();
const workspace = page.frameLocator("#app").frameLocator("#real-editor");
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const pageId = fixture.secondPageId;
const latestEdit = `Latest edits ${Date.now()}.`;
const imageName = `checkpoint-${Date.now()}.png`;
const paragraph = (text: string) => ({
	id: crypto.randomUUID(),
	type: "paragraph",
	props: {},
	content: [{ type: "text", text, styles: {} }],
	children: [],
});
async function saved() {
	const response = await fetch(`${host}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			Accept: "application/json",
			"Mcp-Protocol-Version": "2026-07-28",
			"Mcp-Method": "tools/call",
			"Mcp-Name": "read_page",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "tools/call",
			params: {
				name: "read_page",
				arguments: {
					workspaceId: fixture.workspaceId,
					pageId,
					format: "blocks",
				},
				_meta: {
					"io.modelcontextprotocol/protocolVersion": "2026-07-28",
					"io.modelcontextprotocol/clientInfo": {
						name: "Page actions proof",
						version: "1.0.0",
					},
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		}),
	});
	const body = await response.json();
	assert.ok(!body.error && !body.result.isError, JSON.stringify(body));
	return body.result.structuredContent;
}
async function menu(name: string) {
	await workspace
		.locator("header")
		.getByRole("button", { name: "Page actions", exact: true })
		.click();
	await workspace.getByRole("menuitem", { name, exact: true }).click();
}
async function closeDialog() {
	await workspace
		.getByRole("dialog")
		.getByRole("button", { name: "Close", exact: true })
		.click();
}
try {
	await page.goto(host);
	await workspace
		.getByRole("textbox", { name: "Page title", exact: true })
		.waitFor();
	await workspace
		.getByRole("button", { name: "Expand", exact: true })
		.first()
		.click();
	await workspace.locator(`a[href$="/p/${pageId}"]`).first().click();
	const title = workspace.getByRole("textbox", {
		name: "Page title",
		exact: true,
	});
	await expect(title).toHaveValue("Release checklist");
	const editor = workspace.locator(".bn-editor[contenteditable=true]");
	await editor.waitFor();
	// A private image in the checkpoint proves history and HTML export use the embed credential.
	await editor.evaluate((element, filename) => {
		const bytes = Uint8Array.from(
			atob(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
			),
			(c) => c.charCodeAt(0),
		);
		const transfer = new DataTransfer();
		transfer.items.add(new File([bytes], filename, { type: "image/png" }));
		element.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: transfer,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, imageName);
	await expect
		.poll(async () => JSON.stringify(await saved()))
		.toContain(imageName);
	await expect
		.poll(
			async () =>
				(await saved()).blocks
					.filter((block: { type: string }) => block.type === "image")
					.every((block: { props: { url: string } }) => !!block.props.url),
			{ timeout: 30000 },
		)
		.toBe(true);
	const checkpoint = await (
		await fetch(`${host}/test/checkpoint`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pageId }),
		})
	).json();
	assert.ok(checkpoint.id);
	const firstParagraph = editor.locator(".bn-inline-content").first();
	await firstParagraph.click();
	await page.keyboard.press("End");
	await page.keyboard.type(` ${latestEdit}`);
	await workspace.getByRole("button", { name: /^Open page history/ }).click();
	const history = workspace.getByRole("dialog", {
		name: "Page history",
		exact: true,
	});
	await expect(
		history.getByText(/page history restores this canvas/),
	).toBeVisible();
	await expect(history.locator(".tl-container")).toHaveCount(0);
	await expect
		.poll(() =>
			history
				.locator("img[src^='blob:']")
				.first()
				.evaluate((img) => (img as HTMLImageElement).naturalWidth),
		)
		.toBe(1);
	await page.screenshot({
		path: `${output}/embedded-history.png`,
		fullPage: true,
	});
	// A failed restore leaves the dialog and current edits available for retry.
	await page.route(
		"**/versions/*/restore",
		(route) =>
			route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({
					code: "INTERNAL_ERROR",
					message: "Could not restore",
				}),
			}),
		{ times: 1 },
	);
	await history.getByRole("button", { name: "Restore this version" }).click();
	await expect(history.getByRole("alert")).toBeVisible();
	assert.ok(JSON.stringify(await saved()).includes(latestEdit));
	await history.getByRole("button", { name: "Restore this version" }).click();
	await expect(history).toHaveCount(0);
	await expect
		.poll(async () => JSON.stringify(await saved()))
		.not.toContain(latestEdit);
	await expect(editor).not.toContainText(latestEdit);
	await workspace.getByRole("button", { name: /^Open page history/ }).click();
	await expect(history).toContainText("Before a restore");
	await expect(history).toContainText(latestEdit);
	await closeDialog();
	console.log(
		"PASS: history previews private images, preserves edits on failure, restores live, and retains the replaced version",
	);

	await menu("Share");
	const publicLink = workspace.getByRole("textbox", {
		name: "Public page link",
	});
	const publish = workspace.getByRole("button", {
		name: "Publish",
		exact: true,
	});
	await expect
		.poll(async () => (await publicLink.count()) + (await publish.count()))
		.toBe(1);
	if (await publish.count()) await publish.click();
	await expect(publicLink).toHaveValue(/\/share\//);
	const shareUrl = await publicLink.inputValue();
	assert.equal((await fetch(shareUrl)).status, 200);

	await workspace
		.getByRole("button", { name: "Copy link", exact: true })
		.click();
	await expect(
		workspace.getByRole("button", { name: "Link copied", exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: `${output}/embedded-sharing.png`,
		fullPage: true,
	});
	await workspace
		.getByRole("button", { name: "Revoke link", exact: true })
		.click();
	await workspace
		.getByRole("dialog", { name: "Revoke public link?", exact: true })
		.getByRole("button", { name: "Revoke link", exact: true })
		.click();
	await expect(
		workspace.getByRole("button", { name: "Publish", exact: true }),
	).toBeVisible();
	assert.equal(
		(
			await fetch(
				`${fixture.appOrigin}/api/shared/${shareUrl.split("/").at(-1)}`,
			)
		).status,
		404,
	);
	await closeDialog();
	console.log("PASS: publish, copy, and revoke use the shared page actions");

	for (const format of ["Markdown", "HTML"]) {
		const pending = page.waitForEvent("download");
		await menu(`Export ${format}`);
		const download = await pending;
		const file = await download.path();
		assert.ok(file);
		const content = await readFile(file, "utf8");
		assert.ok(content.includes("Keep the existing task"));
		assert.ok(!content.includes("HaunterEmbed") && !content.includes("blob:"));
		if (format === "HTML")
			assert.ok(content.includes("data:image/png;base64,"));
	}
	console.log(
		"PASS: Markdown and HTML download; HTML includes authenticated private images",
	);

	await workspace
		.getByRole("button", { name: "More page actions", exact: true })
		.click();
	await workspace
		.getByRole("menuitem", { name: "Recover drafts", exact: true })
		.click();
	const recovery = workspace.getByRole("dialog", {
		name: "Recover drafts",
		exact: true,
	});
	await recovery.getByLabel("Recovery file").setInputFiles({
		name: "recovery.json",
		mimeType: "application/json",
		buffer: Buffer.from(
			JSON.stringify({
				format: "haunter-draft-recovery",
				version: 1,
				pages: [
					{
						id: "recovered",
						title: "Recovered panel notes",
						content: [paragraph("Recovered inside Haunter")],
					},
				],
				canvases: [{ id: "drawing", snapshot: {} }],
			}),
		),
	});
	await expect(recovery).toContainText(
		"1 pages and 1 canvases will be created.",
	);
	await recovery
		.getByRole("button", { name: "Recover as new pages", exact: true })
		.click();
	await expect(title).toHaveValue("Recovered panel notes");
	await expect(editor).toContainText("Recovered inside Haunter");
	console.log(
		"PASS: recovery imports new copies and opens the recovered page inside the workspace",
	);
	await menu("Move to trash");
	await workspace
		.getByRole("dialog", { name: "Move to trash?", exact: true })
		.getByRole("button", { name: "Move to trash", exact: true })
		.click();
	await expect(title).toHaveCount(0);
	await expect(workspace.getByRole("dialog", { name: "Move to trash?", exact: true })).toHaveCount(0);
	await expect(workspace.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
	console.log(
		"PASS: moving the open page to trash saves first and returns to Home inside the panel",
	);

	// Seed a valid unsynced local copy, as a disconnected drawing session would.
	const snapshot = normalizeCanvasSnapshot({});
	const canvasPage = Object.values(snapshot.store).find(
		(record) => record.typeName === "page",
	);
	assert.ok(canvasPage);
	canvasPage.name = "Recovered drawing";
	const frame = page
		.frames()
		.find((candidate) => candidate.url().includes("/embed/workspace"));
	assert.ok(frame);
	await frame.evaluate(
		async ({ fixture: f, snapshot: payload }) => {
			await new Promise<void>((resolve, reject) => {
				const request = indexedDB.open("haunter-local-drafts", 10);
				request.onerror = () => reject(request.error);
				request.onupgradeneeded = () => {
					if (!request.result.objectStoreNames.contains("drafts"))
						request.result.createObjectStore("drafts", { keyPath: "key" });
				};
				request.onsuccess = () => {
					const db = request.result;
					const transaction = db.transaction("drafts", "readwrite");
					transaction.objectStore("drafts").put({
						key: JSON.stringify([f.userId, "canvas", f.canvasId]),
						userId: f.userId,
						workspaceId: f.workspaceId,
						resourceType: "canvas",
						resourceId: f.canvasId,
						baseVersion: null,
						status: "conflict",
						updatedAt: new Date().toISOString(),
						payload: JSON.parse(payload),
					});
					transaction.oncomplete = () => {
						db.close();
						resolve();
					};
					transaction.onerror = () => {
						db.close();
						reject(transaction.error);
					};
				};
			});
		},
		{ fixture, snapshot: JSON.stringify(snapshot) },
	);
	await workspace.locator(`a[href$="/p/${pageId}"]`).first().click();
	await workspace
		.getByRole("button", { name: "Recover as new canvas", exact: true })
		.click();
	await expect(title).toHaveCount(0);
	await expect(workspace.locator(".tl-container")).toBeVisible();
	await expect(
		workspace.getByRole("button", {
			name: "Recover as new canvas",
			exact: true,
		}),
	).toHaveCount(0);
	await page.screenshot({
		path: `${output}/embedded-canvas-recovery.png`,
		fullPage: true,
	});
	console.log(
		"PASS: an unsynced drawing is recovered and opened as a separate canvas in the panel",
	);
	await workspace.locator(`a[href$="/p/${pageId}"]`).first().click();
	await expect(title).toHaveValue("Release checklist");
	await page.getByLabel("Width", { exact: true }).selectOption("390");
	await workspace.getByRole("button", { name: /^Open page history/ }).click();
	const narrowHistory = workspace.getByRole("dialog", {
		name: "History",
		exact: true,
	});
	await narrowHistory
		.getByRole("button", { name: /Checkpoint|Before a restore/ })
		.first()
		.click();
	await expect(
		workspace.getByRole("button", {
			name: "Restore this version",
			exact: true,
		}),
	).toBeVisible();
	await page.screenshot({
		path: `${output}/embedded-history-narrow.png`,
		fullPage: true,
	});
	await page.keyboard.press("Escape");
	await workspace
		.locator("header")
		.getByRole("button", { name: "Page actions", exact: true })
		.click();
	await workspace
		.getByRole("dialog", { name: "Actions", exact: true })
		.getByRole("button", { name: "Share", exact: true })
		.click();
	await expect(
		workspace.getByRole("button", { name: "Publish", exact: true }),
	).toBeVisible();
	console.log("PASS: history and page actions adapt to a 390px panel");

	const web = await context.newPage();
	await web.goto("http://127.0.0.1:8797/login");
	await web.goto(`${fixture.appOrigin}/w/${fixture.workspaceId}/p/${pageId}`);
	await web.getByRole("button", { name: /^Open page history/ }).click();
	await expect(
		web.getByRole("dialog", { name: "Page history", exact: true }),
	).toContainText("Before a restore");
	await web
		.getByRole("dialog")
		.getByRole("button", { name: "Close", exact: true })
		.click();
	await web
		.locator("header")
		.getByRole("button", { name: "Page actions", exact: true })
		.click();
	await web.getByRole("menuitem", { name: "Share", exact: true }).click();
	await expect(
		web.getByRole("button", { name: "Publish", exact: true }),
	).toBeVisible();
	console.log(
		"PASS: the regular web app still opens the same history and sharing controls",
	);
	assert.deepEqual(errors, []);
} catch (error) {
	await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
	throw error;
} finally {
	await browser.close();
}
