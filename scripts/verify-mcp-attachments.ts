import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "playwright/test";

// Runs only against the disposable synthetic account from preview-mcp-editor.ts.
const fixture = await (await fetch("http://localhost:8797/fixture")).json();
const output = "/private/tmp/haunter-attachments-proof";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 1100 },
});
context.setDefaultTimeout(30000);
const page = await context.newPage();
const workspace = page.frameLocator("#app").frameLocator("#real-editor");
const errors: string[] = [];
const files: {
	url: string;
	status: number;
	authenticated: boolean;
	cookies: boolean;
}[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
	if (
		!response.url().includes("/api/files/") &&
		!response.url().includes("/api/uploads/")
	)
		return;
	const headers = response.request().headers();
	files.push({
		url: response.url(),
		status: response.status(),
		authenticated: !!headers.authorization?.startsWith("HaunterEmbed "),
		cookies: !!headers.cookie,
	});
});
async function rpc(name: string, args: Record<string, unknown> = {}) {
	const response = await fetch("http://localhost:8797/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			"Mcp-Protocol-Version": "2026-07-28",
			"Mcp-Method": "tools/call",
			"Mcp-Name": name,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "tools/call",
			params: {
				name,
				arguments: {
					workspaceId: fixture.workspaceId,
					pageId: fixture.pageId,
					...args,
				},
				_meta: {
					"io.modelcontextprotocol/protocolVersion": "2026-07-28",
					"io.modelcontextprotocol/clientInfo": {
						name: "Attachment proof",
						version: "1.0.0",
					},
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		}),
	});
	const body = await response.json();
	assert.ok(!body.error && !body.result?.isError, JSON.stringify(body));
	return body.result;
}
const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
try {
	const created = await rpc("create_page", {
		title: `Attachment proof ${Date.now()}`,
		markdown: "Files and images in the embedded editor.",
	});
	fixture.pageId = created.structuredContent.pageId;
	fixture.webUrl = `${fixture.appOrigin}/w/${fixture.workspaceId}/p/${fixture.pageId}`;
	await page.goto("http://localhost:8797/");
	await workspace
		.getByRole("textbox", { name: "Page title", exact: true })
		.waitFor();
	await workspace.locator(`a[href$="/p/${fixture.pageId}"]`).first().click();
	await expect(
		workspace.getByRole("textbox", { name: "Page title", exact: true }),
	).toHaveValue(created.structuredContent.title);
	const editor = workspace.locator(".bn-editor[contenteditable=true]");
	await editor.waitFor();
	await editor.click();
	await page.keyboard.press("ControlOrMeta+End");
	await editor.evaluate((node, png) => {
		const transfer = new DataTransfer();
		transfer.items.add(
			new File(
				[Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
				"proof.png",
				{ type: "image/png" },
			),
		);
		node.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: transfer,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, png);
	await expect
		.poll(
			async () =>
				(await rpc("list_page_attachments")).structuredContent.attachments
					.length,
		)
		.toBe(1);
	const image = workspace.locator(
		'.bn-block-content[data-content-type="image"] img',
	);
	await expect(image).toHaveAttribute("src", /^blob:/);
	await expect
		.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth))
		.toBe(1);
	await editor.evaluate((node) => {
		const transfer = new DataTransfer();
		transfer.items.add(
			new File(["Attachment proof: moonlight on the lake."], "notes.txt", {
				type: "text/plain",
			}),
		);
		const box = node.getBoundingClientRect();
		node.dispatchEvent(
			new DragEvent("drop", {
				dataTransfer: transfer,
				bubbles: true,
				cancelable: true,
				clientX: box.x + 50,
				clientY: box.bottom - 4,
			}),
		);
	});
	await expect
		.poll(
			async () =>
				(await rpc("list_page_attachments")).structuredContent.attachments
					.length,
		)
		.toBe(2);
	await editor.click();
	await page.keyboard.press("ControlOrMeta+End");
	await page.keyboard.press("Enter");
	await page.keyboard.type("/file");
	await workspace.getByRole("option", { name: /^File/ }).click();
	await workspace
		.locator('input[type="file"]')
		.setInputFiles({
			name: "picked.md",
			mimeType: "text/markdown",
			buffer: Buffer.from("# From the file picker"),
		});
	await expect
		.poll(
			async () =>
				(await rpc("list_page_attachments")).structuredContent.attachments
					.length,
		)
		.toBe(3);
	const attached = (await rpc("list_page_attachments")).structuredContent
		.attachments as { blockId: string; name: string; mimeType: string }[];
	const imageInfo = attached.find((item) => item.mimeType === "image/png");
	const textInfo = attached.find((item) => item.mimeType === "text/plain");
	assert.ok(imageInfo && textInfo);
	const readImage = await rpc("read_page_attachment", {
		blockId: imageInfo.blockId,
	});
	assert.equal(readImage.content[1].type, "image");
	assert.equal(readImage.content[1].data, png);
	const readText = await rpc("read_page_attachment", {
		blockId: textInfo.blockId,
	});
	assert.equal(
		readText.content[1].resource.text,
		"Attachment proof: moonlight on the lake.",
	);
	const before = (await rpc("read_page", { format: "blocks" }))
		.structuredContent;
	await rpc("edit_page_blocks", {
		expectedRevision: before.revision,
		operations: [
			{
				op: "update",
				blockId: imageInfo.blockId,
				props: { caption: "Moonlight image" },
			},
			{
				op: "update",
				blockId: textInfo.blockId,
				props: {
					name: "Lake notes.txt",
					caption: "Notes attached in the panel",
				},
			},
		],
	});
	await workspace.getByText("Moonlight image", { exact: true }).waitFor();
	await workspace.getByText("Lake notes.txt", { exact: true }).click();
	await workspace
		.getByRole("button", { name: "Download attachment", exact: true })
		.waitFor();
	const download = page.waitForEvent("download");
	await workspace
		.getByRole("button", { name: "Download attachment", exact: true })
		.click();
	assert.equal((await download).suggestedFilename(), "Lake notes.txt");
	await workspace.getByRole("link", { name: "Home", exact: true }).click();
	await workspace.locator(`a[href$="/p/${fixture.pageId}"]`).first().click();
	await expect(
		workspace.getByText("Lake notes.txt", { exact: true }),
	).toBeVisible();
	await expect(image).toHaveAttribute("src", /^blob:/);
	await page.screenshot({
		path: `${output}/embedded-attachments.png`,
		fullPage: true,
	});
	const saved = JSON.stringify(
		(await rpc("read_page", { format: "blocks" })).structuredContent.blocks,
	);
	assert.ok(!saved.includes("blob:") && !saved.includes("HaunterEmbed"));
	assert.ok(
		files.some(
			(file) =>
				file.url.endsWith("/api/uploads/pages.attachment/upload") &&
				file.status === 200,
		),
	);
	assert.ok(
		files.every(
			(file) => file.authenticated && !file.cookies && file.status === 200,
		),
	);
	assert.ok(files.every((file) => !new URL(file.url).search));
	const publicFile = files.find((file) => file.url.includes("/api/files/"));
	assert.ok(publicFile);
	assert.equal((await fetch(publicFile.url)).status, 404);
	// Regular cookie-authenticated web app opens the same bytes and persisted captions.
	const web = await context.newPage();
	await web.goto("http://127.0.0.1:8797/login");
	await web.goto(fixture.webUrl);
	await web.getByText("Lake notes.txt", { exact: true }).waitFor();
	const webImage = web.locator(
		'.bn-block-content[data-content-type="image"] img',
	);
	await expect
		.poll(() =>
			webImage.evaluate((img) => (img as HTMLImageElement).naturalWidth),
		)
		.toBe(1);
	await expect(webImage).toHaveAttribute("src", /^\/api\/files\//);
	await web.screenshot({
		path: `${output}/web-attachments.png`,
		fullPage: true,
	});
	assert.deepEqual(errors, []);
	console.log(
		"PASS: file picker, pasted image, dropped document, authenticated previews/download, native MCP image/text reads, live caption edits, navigation, private URLs, and web-app parity.",
	);
} finally {
	await browser.close();
}
