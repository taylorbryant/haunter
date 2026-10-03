import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type WebSocketRoute } from "playwright";

// Uses only preview:mcp-editor's disposable workspace and approved connection.
const origin = "http://127.0.0.1:8797";
const artifacts = "/private/tmp/haunter-canvas-proof";
await mkdir(artifacts, { recursive: true });
const fixture = (await (await fetch(`${origin}/fixture`)).json()) as {
	workspaceId: string;
	pageId: string;
	secondPageId: string;
	canvasId: string;
	appOrigin: string;
};
async function tool(name: string, args: Record<string, unknown>) {
	const response = await fetch(`${origin}/mcp`, {
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
				arguments: { workspaceId: fixture.workspaceId, ...args },
				_meta: {
					"io.modelcontextprotocol/protocolVersion": "2026-07-28",
					"io.modelcontextprotocol/clientInfo": {
						name: "Canvas proof",
						version: "1.0.0",
					},
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		}),
	});
	const result = await response.json();
	assert.ok(!result.error && !result.result?.isError, JSON.stringify(result));
	return result.result;
}
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1380, height: 1100 },
});
context.setDefaultTimeout(30_000);
let offline = false;
const sockets = new Set<WebSocketRoute>();
await context.routeWebSocket(/127\.0\.0\.1:1397/, (socket) => {
	sockets.add(socket);
	if (offline) {
		socket.onMessage(() => {});
		return;
	}
	const server = socket.connectToServer();
	socket.onMessage((message) => {
		if (!offline) server.send(message);
	});
	server.onMessage((message) => {
		if (!offline) socket.send(message);
	});
});
const page = await context.newPage();
const app = page.frameLocator("#app");
const embedded = app.frameLocator("#real-editor");
async function currentView() {
	const text = await page.locator("#context").textContent();
	return JSON.parse(text?.split("\n")[1] ?? "null");
}
async function until(check: () => Promise<boolean>) {
	const deadline = Date.now() + 30_000;
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error("Canvas proof timed out");
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}
try {
	await page.goto("http://localhost:8797/");
	await embedded
		.getByRole("textbox", { name: "Page title", exact: true })
		.waitFor();
	await app.locator(".tree-toggle").click();
	await app
		.locator(`.page-link[data-page-id="${fixture.secondPageId}"]`)
		.click();
	await embedded
		.getByRole("button", { name: "Open canvas", exact: true })
		.click();
	await embedded.locator(".tl-canvas").waitFor();
	await until(
		async () =>
			(await currentView())?.canvasId === fixture.canvasId &&
			(await currentView())?.editorStatus === "ready",
	);
	assert.equal((await context.cookies()).length, 0);
	console.log(
		"PASS: a page canvas opens the real interactive editor without browser cookies",
	);
	const bounds = await embedded.locator(".tl-canvas").boundingBox();
	assert.ok(bounds);
	await embedded.locator(".tl-canvas").click({ position: { x: 280, y: 220 } });
	await page.keyboard.press("r");
	await page.mouse.move(bounds.x + 220, bounds.y + 200);
	await page.mouse.down();
	await page.mouse.move(bounds.x + 400, bounds.y + 310, { steps: 8 });
	await page.mouse.up();
	await until(
		async () =>
			(await currentView())?.canvas?.selectionCount === 1 &&
			(await currentView())?.saveStatus === "saved",
	);
	const view = await currentView();
	const shapeId = view.canvas.selectedShapeIds[0];
	const read = (await tool("read_canvas", { canvasId: fixture.canvasId }))
		.structuredContent;
	assert.ok(read.shapes.some((shape: { id: string }) => shape.id === shapeId));
	assert.equal(view.canvas.selectionComplete, true);
	console.log(
		"PASS: panel drawing persists and current canvas/selection metadata reaches the host",
	);
	await tool("edit_canvas", {
		canvasId: fixture.canvasId,
		expectedRevision: read.revision,
		operations: [
			{ op: "update", shapeId, text: "Edited through MCP", color: "violet" },
		],
	});
	await embedded
		.getByText("Edited through MCP", { exact: true })
		.first()
		.waitFor();
	console.log(
		"PASS: the agent reads and edits the selected shape, and its change appears live",
	);
	const web = await context.newPage();
	await web.goto(`${origin}/login`);
	await web.goto(
		`${fixture.appOrigin}/w/${fixture.workspaceId}/c/${fixture.canvasId}`,
	);
	await web.getByText("Edited through MCP", { exact: true }).first().waitFor();
	const webCanvas = web.locator(".tl-canvas");
	await webCanvas.click({ position: { x: 270, y: 350 } });
	await web.keyboard.press("t");
	await webCanvas.click({ position: { x: 270, y: 350 } });
	await web.keyboard.type("Web canvas sync");
	await web.keyboard.press("Escape");
	await embedded
		.getByText("Web canvas sync", { exact: true })
		.first()
		.waitFor();
	console.log(
		"PASS: the regular web canvas sees panel edits and its edits sync back to the panel",
	);
	await page.bringToFront();
	offline = true;
	assert.ok(sockets.size > 0, "Collaboration sockets were intercepted");
	await Promise.all([...sockets].map((socket) => socket.close()));
	await embedded.locator(".tl-canvas").click({ position: { x: 550, y: 370 } });
	await page.keyboard.press("t");
	await embedded.locator(".tl-canvas").click({ position: { x: 550, y: 370 } });
	await page.keyboard.type("Offline canvas draft");
	await page.keyboard.press("Escape");
	await until(async () => (await currentView())?.saveStatus === "unsaved");
	const before = await app.locator("#real-editor").getAttribute("src");
	await embedded
		.getByRole("button", { name: "Back to page", exact: true })
		.click();
	await app
		.getByText("Your changes have not finished saving.", { exact: false })
		.waitFor();
	assert.equal(await app.locator("#real-editor").getAttribute("src"), before);
	await embedded
		.getByText("Offline canvas draft", { exact: true })
		.first()
		.waitFor();
	offline = false;
	await Promise.all([...sockets].map((socket) => socket.close()));
	await embedded
		.locator("html")
		.evaluate(() => window.dispatchEvent(new Event("online")));
	await until(async () => (await currentView())?.saveStatus === "saved");
	console.log(
		"PASS: offline canvas changes block navigation, stay editable, and save after reconnection",
	);
	await page.screenshot({
		path: `${artifacts}/canvas-desktop.png`,
		fullPage: true,
	});
	await embedded
		.getByRole("button", { name: "Back to page", exact: true })
		.click();
	await embedded
		.getByRole("button", { name: "Open canvas", exact: true })
		.click();
	await embedded
		.getByText("Edited through MCP", { exact: true })
		.first()
		.waitFor();
	console.log("PASS: returning to the page and reopening preserves the canvas");
	const webTheme = await web.locator(".tl-container").getAttribute("class");
	const webPreference = await web.evaluate(() =>
		localStorage.getItem("TLDRAW_USER_DATA_v3"),
	);
	await page.getByRole("combobox", { name: "Width" }).selectOption("390");
	await page.getByRole("button", { name: "Switch theme" }).click();
	await embedded.locator("html.dark").waitFor();
	await embedded.locator(".tl-theme__dark").waitFor();
	await until(
		async () =>
			Number(
				await embedded.locator(".tlui-layout").getAttribute("data-breakpoint"),
			) < 5,
	);
	const size = await embedded
		.locator("html")
		.evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
	assert.ok(size.scroll <= size.width);
	await page.screenshot({
		path: `${artifacts}/canvas-narrow-dark.png`,
		fullPage: true,
		animations: "disabled",
	});
	assert.equal(
		await web.locator(".tl-container").getAttribute("class"),
		webTheme,
	);
	assert.equal(
		await web.evaluate(() => localStorage.getItem("TLDRAW_USER_DATA_v3")),
		webPreference,
	);
	await web.close();
	console.log(
		"PASS: the canvas supports host theme and narrow layout without changing the web canvas theme",
	);
	const source = (
		await tool("read_page", { pageId: fixture.pageId, format: "markdown" })
	).structuredContent;
	const created = (
		await tool("create_canvas_block", {
			pageId: fixture.pageId,
			expectedRevision: source.revision,
		})
	).structuredContent;
	const opened = await tool("open_haunter_canvas", {
		canvasId: created.canvasId,
	});
	await page.evaluate((result) => {
		const host = document.getElementById("app") as HTMLIFrameElement;
		host.contentWindow?.postMessage(
			{
				jsonrpc: "2.0",
				method: "ui/notifications/tool-result",
				params: result,
			},
			location.origin,
		);
	}, opened);
	await until(
		async () =>
			(await currentView())?.canvasId === created.canvasId &&
			(await currentView())?.editorStatus === "ready",
	);
	console.log(
		"PASS: the agent creates a canvas block and opens it directly through the MCP tool result",
	);
} catch (error) {
	await page
		.screenshot({ path: `${artifacts}/failure.png`, fullPage: true })
		.catch(() => {});
	for (const frame of page.frames())
		console.error(
			"FRAME",
			frame.url(),
			(
				await frame
					.locator("body")
					.innerText()
					.catch(() => "unavailable")
			).slice(0, 2500),
		);
	throw error;
} finally {
	await browser.close();
}
