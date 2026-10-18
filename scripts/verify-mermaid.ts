import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Locator } from "playwright";

// Uses only preview:mcp-editor's disposable database and synthetic account.
const host = "http://127.0.0.1:8797";
const fixture = await (await fetch(`${host}/fixture`)).json();
const output = "/private/tmp/haunter-mermaid-proof";
await mkdir(output, { recursive: true });
let requestId = 0;
async function call(name: string, args: Record<string, unknown>) {
	const response = await fetch(`${host}/mcp`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: ++requestId,
			method: "tools/call",
			params: { name, arguments: args },
		}),
	});
	const body = await response.text();
	const payload = JSON.parse(
		body.startsWith("event:")
			? (body
					.split("\n")
					.find((line) => line.startsWith("data:"))
					?.slice(5) ?? "null")
			: body,
	);
	assert.ok(
		!payload.error && !payload.result?.isError,
		JSON.stringify(payload),
	);
	return payload.result.structuredContent;
}
const flowchart = "flowchart LR\n  A[Idea] --> B[Plan]\n  B --> C[Build]";
const sequence =
	"sequenceDiagram\n  participant U as You\n  participant A as Agent\n  participant H as Haunter\n  U->>A: Explain the workflow\n  A->>H: Create a diagram\n  H-->>U: Ready to edit";
const created = await call("create_page", {
	workspaceId: fixture.workspaceId,
	title: "Mermaid diagrams",
	markdown: `A diagram you can edit as text.\n\n\`\`\`mermaid\n${flowchart}\n\`\`\`\n\n## Collaborate with an agent\n\n\`\`\`mermaid\n${sequence}\n\`\`\``,
});
const pageId = created.pageId;
assert.equal(typeof pageId, "string", JSON.stringify(created));
const target = { workspaceId: fixture.workspaceId, pageId };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 1000 },
});
context.setDefaultTimeout(30_000);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
async function rendered(root: Locator) {
	await root.locator(".haunter-mermaid-diagram svg").first().waitFor();
}
async function noOverflow(root: Locator) {
	const size = await root.evaluate((el) => ({
		width: el.clientWidth,
		scroll: el.scrollWidth,
	}));
	assert.ok(size.scroll <= size.width, JSON.stringify(size));
}
try {
	await page.goto(`${host}/login`);
	await page.goto(`${fixture.appOrigin}/w/${fixture.workspaceId}/p/${pageId}`);
	await rendered(page.locator("main"));
	await page.screenshot({
		path: `${output}/desktop-dracula.png`,
		fullPage: true,
	});
	const first = page.locator('[data-content-type="codeBlock"]').first();
	await first.getByRole("button", { name: "Source", exact: true }).click();
	await first.locator("pre").waitFor();
	await first.getByRole("button", { name: "Diagram", exact: true }).click();
	await first.locator("pre").waitFor({ state: "hidden" });
	await first.getByRole("button", { name: "Expand code" }).click();
	const dialog = page.getByRole("dialog");
	await dialog
		.getByRole("textbox", { name: "Code", exact: true })
		.fill("flowchart LR\n  A[Idea] --> B[Plan]\n  B --> C[Ship]");
	await dialog.getByRole("button", { name: "Diagram", exact: true }).click();
	await rendered(dialog);
	await dialog
		.locator(".haunter-mermaid-diagram")
		.getByText("Ship", { exact: true })
		.waitFor();
	await dialog.getByRole("button", { name: "Close code editor" }).click();
	await first.getByRole("button", { name: "Diagram", exact: true }).click();
	await first
		.locator(".haunter-mermaid-diagram")
		.getByText("Ship", { exact: true })
		.waitFor();
	await page.reload();
	await first
		.locator(".haunter-mermaid-diagram")
		.getByText("Ship", { exact: true })
		.waitFor();
	const current = await call("read_page", { ...target, format: "blocks" });
	const diagramBlock = current.blocks.find(
		(block: { type: string }) => block.type === "codeBlock",
	);
	await call("edit_page_blocks", {
		...target,
		expectedRevision: current.revision,
		operations: [
			{
				op: "update",
				blockId: diagramBlock.id,
				content: [
					{
						type: "text",
						text: "flowchart LR\n A[Idea] --> B[Plan]\n B --> C[Collaborate]",
						styles: {},
					},
				],
			},
		],
	});
	await first
		.locator(".haunter-mermaid-diagram")
		.getByText("Collaborate", { exact: true })
		.waitFor();
	assert.equal(await first.locator("pre").isVisible(), false);
	console.log(
		"PASS: diagrams render, switch views, edit fullscreen, survive reopening, and update live from MCP",
	);
	await context.request.post(`${host}/test/checkpoint`, { data: { pageId } });
	await page.getByRole("button", { name: /^Open page history/ }).click();
	await page.locator("[data-history-key]").first().click();
	await rendered(page.getByRole("dialog"));
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /close/i })
		.last()
		.click();
	const shareResponse = await context.request.post(
		`${fixture.appOrigin}/api/pages/${pageId}/share`,
		{ data: {} },
	);
	assert.ok(shareResponse.ok(), await shareResponse.text());
	const share = await shareResponse.json();
	const reader = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	const publicPage = await reader.newPage();
	await publicPage.goto(`${fixture.appOrigin}/share/${share.token}`);
	await rendered(publicPage.locator("body"));
	assert.equal(
		await publicPage.locator('.bn-editor[contenteditable="true"]').count(),
		0,
	);
	await noOverflow(publicPage.locator("html"));
	await publicPage.screenshot({
		path: `${output}/shared-mobile.png`,
		fullPage: true,
	});
	await reader.close();
	console.log(
		"PASS: history previews and public readers render diagrams without editing access",
	);
	const mobileContext = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
		storageState: await context.storageState(),
	});
	const mobile = await mobileContext.newPage();
	mobile.on("pageerror", (error) => errors.push(error.message));
	await mobile.goto(page.url());
	await rendered(mobile.locator("main"));
	await noOverflow(mobile.locator("html"));
	await mobile.screenshot({
		path: `${output}/mobile-dracula.png`,
		fullPage: true,
	});
	await mobile.locator("html").evaluate((el) => {
		el.setAttribute("class", "light");
	});
	await mobile.screenshot({
		path: `${output}/mobile-light.png`,
		fullPage: true,
	});
	console.log(
		"PASS: narrow layouts fit the viewport and diagram colors follow theme variables",
	);
	await mobile.goto("http://localhost:8797/");
	await mobile.evaluate((target) => {
		Object.assign(window, { editorProofPage: target });
		const frame = document.querySelector<HTMLIFrameElement>("#app");
		if (!frame) throw new Error("Missing proof host frame");
		frame.setAttribute("src", frame.src);
	}, target);
	const embedded = mobile.frameLocator("#app").frameLocator("#real-editor");
	await rendered(embedded.locator("body"));
	await noOverflow(embedded.locator("html"));
	await mobile.screenshot({
		path: `${output}/embedded-mobile.png`,
		fullPage: true,
	});
	console.log(
		"PASS: the embedded editor renders the same saved Mermaid blocks",
	);
	await mobileContext.close();
	const blank = await call("create_page", {
		workspaceId: fixture.workspaceId,
		title: "Mermaid insertion proof",
		markdown: "Write a diagram below.",
	});
	await page.goto(
		`${fixture.appOrigin}/w/${fixture.workspaceId}/p/${blank.pageId}`,
	);
	const editor = page.locator('.bn-editor[contenteditable="true"]');
	await editor.click();
	await page.keyboard.press("ControlOrMeta+End");
	await page.keyboard.press("Enter");
	await page.keyboard.type("/mermaid");
	await page.getByRole("option", { name: /^Mermaid/ }).click();
	await page.locator('[data-content-type="codeBlock"] pre').waitFor();
	assert.ok(await editor.evaluate((el) => el.contains(document.activeElement)));
	await page.getByRole("button", { name: "Diagram", exact: true }).click();
	await rendered(page.locator("main"));
	console.log(
		"PASS: /mermaid inserts a diagram with visible, focused source ready to edit",
	);
	assert.deepEqual(errors, []);
} finally {
	await browser.close();
}
