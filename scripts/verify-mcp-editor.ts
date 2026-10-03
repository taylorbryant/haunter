import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Locator, type WebSocketRoute } from "playwright";

// Run against preview:mcp-editor, which owns only synthetic, disposable data.
const origin = "http://127.0.0.1:8797";
const artifacts = resolve(
	process.env.MCP_EDITOR_PROOF_OUTPUT ?? "/private/tmp/haunter-editor-proof",
);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 1100 },
});
context.setDefaultTimeout(30_000);
let collaborationOffline = false;
const sockets = new Set<WebSocketRoute>();
await context.routeWebSocket(/127\.0\.0\.1:1397/, (socket) => {
	if (collaborationOffline) {
		void socket.close();
		return;
	}
	sockets.add(socket);
	socket.connectToServer();
});
async function append(editor: Locator, text: string) {
	await editor.evaluate((element) => {
		element.focus();
		const range = document.createRange();
		range.selectNodeContents(element);
		range.collapse(false);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	});
	await editor.press("Enter");
	await editor.pressSequentially(text);
}
try {
	const fixture = (await (await fetch(`${origin}/fixture`)).json()) as {
		webUrl: string;
		pageId: string;
		secondPageId: string;
		secondWorkspaceId: string;
	};
	const page = await context.newPage();
	await page.goto("http://localhost:8797/");
	assert.equal((await context.cookies()).length, 0);
	const app = page.frameLocator("#app");
	const editorFrame = app.frameLocator("#real-editor");
	const body = editorFrame.getByRole("textbox", { name: "", exact: true });
	await body.waitFor();
	console.log(
		"PASS: the real editor loads under a different top-level site with no browser cookies",
	);
	assert.equal(
		await page.locator("#context").textContent(),
		"No context attached.",
	);
	// Changing workspaces must authorize the new scope and load its page.
	await app
		.getByRole("combobox", { name: "Workspace", exact: true })
		.selectOption(fixture.secondWorkspaceId);
	await app
		.getByRole("button", { name: "Team notes", exact: true })
		.first()
		.click();
	await body
		.getByText("Workspace switching uses a new scoped session.", {
			exact: true,
		})
		.waitFor();
	await app
		.getByRole("combobox", { name: "Workspace", exact: true })
		.selectOption("document-workspace");
	await app.locator(`.page-link[data-page-id="${fixture.pageId}"]`).click();
	await body.waitFor();
	console.log(
		"PASS: workspace switching authorizes and opens a different workspace",
	);
	const stamp = Date.now();
	const panelText = `Panel persistence proof ${stamp}.`;
	await append(body, panelText);

	// Keep an unsynced edit on screen when the collaboration server disappears.
	collaborationOffline = true;
	await Promise.all([...sockets].map((socket) => socket.close()));
	await append(body, `Offline draft ${stamp}.`);
	const beforeFailedSwitch = await app
		.locator("#real-editor")
		.getAttribute("src");
	await app.getByRole("button", { name: "Home", exact: true }).click();
	await app
		.getByText("Your changes have not finished saving.", { exact: false })
		.waitFor();
	assert.equal(
		await app.locator("#real-editor").getAttribute("src"),
		beforeFailedSwitch,
	);
	await body.getByText(`Offline draft ${stamp}.`, { exact: true }).waitFor();
	assert.equal(
		await editorFrame
			.locator("body")
			.evaluate((element) => element instanceof HTMLElement && element.inert),
		false,
	);
	collaborationOffline = false;
	await editorFrame
		.locator("html")
		.evaluate(() => window.dispatchEvent(new Event("online")));
	await editorFrame
		.getByText("Saved in this browser", { exact: true })
		.waitFor({ state: "hidden" });
	console.log(
		"PASS: an interrupted connection blocks navigation and retains the editable draft",
	);
	await app
		.getByRole("button", { name: /Use as context|Update context/ })
		.click();
	await page.waitForFunction(
		(text) => document.getElementById("context")?.textContent?.includes(text),
		panelText,
	);
	const saved = await (await fetch(`${origin}/saved`)).json();
	assert.ok(JSON.stringify(saved).includes(panelText));
	console.log(
		"PASS: typed panel text reaches the database and saved-page context",
	);
	// Switch immediately after typing, with no explicit context/save action.
	const switchedText = `Saved while switching ${stamp}.`;
	await append(body, switchedText);
	await app.locator(".tree-toggle").click();
	await app
		.locator(`.page-link[data-page-id="${fixture.secondPageId}"]`)
		.click();
	await body
		.getByText("A second page for navigation and save verification.", {
			exact: true,
		})
		.waitFor();

	await editorFrame
		.getByRole("button", { name: "Canvas · Open in Haunter", exact: true })
		.waitFor();
	await editorFrame
		.getByRole("button", { name: "Linked page · Open in Haunter", exact: true })
		.waitFor();
	await editorFrame
		.getByRole("button", {
			name: "Page mention · Open in Haunter",
			exact: true,
		})
		.waitFor();
	assert.equal(
		await editorFrame
			.getByRole("button", { name: /Open page history/ })
			.count(),
		0,
	);
	await editorFrame
		.getByRole("button", { name: "Expand code", exact: true })
		.click();
	const codeText = `const savedFromDialog = ${stamp};`;
	await editorFrame
		.getByRole("textbox", { name: "Code", exact: true })
		.fill(codeText);
	// Navigate with the code dialog still open; its draft must be in the document.
	await app.locator(`.page-link[data-page-id="${fixture.pageId}"]`).click();
	await body.getByText(switchedText, { exact: true }).waitFor();
	await app
		.locator(`.page-link[data-page-id="${fixture.secondPageId}"]`)
		.click();
	await body.getByText(codeText, { exact: true }).waitFor();
	await app.locator(`.page-link[data-page-id="${fixture.pageId}"]`).click();
	await body.getByText(switchedText, { exact: true }).waitFor();
	console.log(
		"PASS: unsupported integrations use web links and code-dialog edits survive navigation",
	);
	await app.getByRole("button", { name: "Home", exact: true }).click();
	await app.locator(`.page-link[data-page-id="${fixture.pageId}"]`).click();
	await body.getByText(panelText, { exact: true }).waitFor();
	console.log(
		"PASS: switching pages and returning Home retain pending edits and attached context",
	);
	const web = await context.newPage();
	await web.goto(`${origin}/login`);
	await web.goto(fixture.webUrl);
	const webBody = web.getByRole("textbox", { name: "", exact: true });
	await webBody.getByText(panelText, { exact: true }).waitFor();
	const webTheme = await web.locator("html").getAttribute("class");
	const webText = `Web collaboration proof ${stamp}.`;
	await append(webBody, webText);
	await page.bringToFront();
	// Collaborative cursors add their name inside the block's accessible text.
	await body.getByText(webText).waitFor();
	console.log(
		"PASS: web app sees the panel edit and web edits sync back to the panel",
	);
	await page.bringToFront();
	await body.getByText(webText).evaluate((element, text) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		let node = walker.nextNode();
		while (node && !node.textContent?.includes(text)) node = walker.nextNode();
		if (!node) throw new Error("Selected passage is missing.");
		const start = node.textContent?.indexOf(text) ?? 0;
		const range = document.createRange();
		range.setStart(node, start);
		range.setEnd(node, start + text.length);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}, webText);
	await editorFrame
		.getByRole("button", { name: "Use selection as context", exact: true })
		.click();
	await page.waitForFunction(
		(text) => document.getElementById("context")?.textContent?.includes(text),
		webText,
	);
	assert.match(
		(await page.locator("#context").textContent()) ?? "",
		/may include changes that have not been saved/,
	);
	console.log("PASS: explicitly selected live text reaches host context");
	await page.screenshot({
		path: `${artifacts}/editor-light.png`,
		fullPage: true,
	});
	await page.getByRole("combobox", { name: "Width" }).selectOption("390");
	await page.getByRole("button", { name: "Switch theme" }).click();
	await app.locator("html").waitFor({ state: "attached" });
	await body.evaluate(
		() =>
			new Promise<void>((r) =>
				requestAnimationFrame(() => requestAnimationFrame(() => r())),
			),
	);
	await editorFrame.locator("html.dark").waitFor();
	assert.equal(await web.locator("html").getAttribute("class"), webTheme);
	const dimensions = await editorFrame.locator("html").evaluate((element) => ({
		width: element.clientWidth,
		scroll: element.scrollWidth,
	}));
	assert.ok(
		dimensions.scroll <= dimensions.width,
		`Embedded editor overflows: ${JSON.stringify(dimensions)}`,
	);
	await page.screenshot({
		path: `${artifacts}/editor-narrow-dark.png`,
		fullPage: true,
	});
	console.log(
		"PASS: host theme reaches Haunter, preserves web-app appearance, and the 390px panel has no horizontal overflow",
	);

	const freshContext = await browser.newContext();
	let authorization = "";
	let renewals = 0;
	freshContext.on("request", (request) => {
		const header = request.headers().authorization;
		if (header?.startsWith("HaunterEmbed ")) authorization = header;
		if (request.url().endsWith("/api/embedded-editor/exchange")) renewals++;
	});
	const fresh = await freshContext.newPage();
	await fresh.goto("http://localhost:8797/");
	const freshApp = fresh.frameLocator("#app");
	const freshEditor = freshApp.frameLocator("#real-editor");
	await freshEditor.getByRole("textbox", { name: "", exact: true }).waitFor();
	assert.equal((await freshContext.cookies()).length, 0);
	await fresh.screenshot({
		path: `${artifacts}/editor-cookie-free.png`,
		fullPage: true,
	});
	console.log(
		"PASS: another fresh cookie-free browser opens the saved document",
	);
	// Recovery requests a new credential while keeping the document identity stable.
	const initialRenewals = renewals;
	await freshEditor
		.locator("html")
		.evaluate(() => window.dispatchEvent(new Event("online")));
	await freshEditor.getByRole("textbox", { name: "", exact: true }).waitFor();
	await freshApp
		.getByRole("button", { name: /Use as context|Update context/ })
		.click();
	assert.ok(renewals > initialRenewals);
	console.log(
		"PASS: embedded session recovery renews access and keeps saved-page context available",
	);
	async function access(mode: "view" | "edit" | "revoke") {
		const response = await fetch(`${origin}/test/access`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mode }),
		});
		assert.equal(response.status, 204);
	}
	await access("view");
	await freshEditor
		.locator("html")
		.evaluate(() => window.dispatchEvent(new Event("online")));
	await freshEditor.locator('.bn-editor[contenteditable="false"]').waitFor();
	assert.ok(authorization);
	const writeStatus = await freshEditor.locator("html").evaluate(
		async (_, input) => {
			const response = await fetch(`/api/pages/${input.pageId}`, {
				method: "PATCH",
				credentials: "omit",
				headers: {
					Authorization: input.authorization,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ title: "Must not save" }),
			});
			return response.status;
		},
		{ authorization, pageId: fixture.pageId },
	);
	assert.equal(writeStatus, 403);
	console.log(
		"PASS: read-only consent disables editing and the API rejects writes",
	);
	await access("revoke");
	const readStatus = await freshEditor.locator("html").evaluate(
		async (_, input) =>
			(
				await fetch(`/api/pages/${input.pageId}/metadata`, {
					credentials: "omit",
					headers: { Authorization: input.authorization },
				})
			).status,
		{ authorization, pageId: fixture.pageId },
	);
	assert.equal(readStatus, 401);
	await freshEditor
		.locator("html")
		.evaluate(() => window.dispatchEvent(new Event("online")));
	await freshEditor
		.getByText("Editor access could not be verified.", { exact: false })
		.waitFor();
	assert.equal(
		await freshEditor
			.getByRole("button", { name: "Sign in", exact: true })
			.count(),
		0,
	);

	await fresh.reload();
	await freshApp
		.getByText("Haunter could not open this panel.", { exact: false })
		.waitFor();
	assert.equal(await freshApp.locator("#real-editor").isVisible(), false);
	console.log(
		"PASS: disconnect invalidates the existing credential and reopening cannot authorize",
	);

	// A revoked connection remains revoked; restart the preview for another run.
	await freshContext.close();
	console.log(`Evidence saved in ${artifacts}`);
} catch (error) {
	for (const [i, ctx] of browser.contexts().entries())
		for (const [j, page] of ctx.pages().entries()) {
			await page
				.screenshot({
					path: `${artifacts}/failure-${i}-${j}.png`,
					fullPage: true,
				})
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
					).slice(0, 1800),
				);
		}
	throw error;
} finally {
	await browser.close();
}
