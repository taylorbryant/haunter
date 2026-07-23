import { describe, expect, it } from "bun:test";
import { pageExportFilename } from "@/features/pages/lib/export-filename";
import {
	type PageHtmlTheme,
	pageToHtmlDocument,
} from "@/features/pages/lib/html";
import type { BlockJson } from "@/features/pages/schemas";

const theme: PageHtmlTheme = {
	id: "dracula",
	label: "Dracula",
	colorScheme: "dark",
	themeColor: "#282a36",
	background: "#282a36",
	foreground: "#f8f8f2",
	muted: "#44475a",
	mutedForeground: "#bfbfbf",
	border: "#6272a4",
	card: "#343746",
	primary: "#bd93f9",
	destructive: "#ff5555",
	codeBackground: "#282a36",
	codeHeaderBackground: "#21222c",
	codeForeground: "#f8f8f2",
};

function block(
	type: string,
	props: Record<string, unknown>,
	text?: string,
	children: BlockJson[] = [],
): BlockJson {
	return {
		id: crypto.randomUUID(),
		type,
		props,
		content:
			text === undefined ? undefined : [{ type: "text", text, styles: {} }],
		children,
	};
}

describe("pageToHtmlDocument", () => {
	it("creates a themed standalone document with the public share layout", async () => {
		const html = await pageToHtmlDocument({
			title: "Release plan",
			icon: "🦇",
			theme,
			sourceUrl: "https://haunter.app/w/ws/p/page",
			content: [
				block(
					"heading",
					{ level: 2, textColor: "red", backgroundColor: "blue" },
					"Priorities",
				),
				{
					id: "styled-paragraph",
					type: "paragraph",
					props: {},
					content: [
						{
							type: "text",
							text: "Highlighted",
							styles: { textColor: "yellow", backgroundColor: "purple" },
						},
					],
					children: [],
				},
				block("bulletListItem", {}, "Ship", [
					block("bulletListItem", {}, "Verify"),
				]),
				block(
					"task",
					{ checked: true, due: "2026-08-01", dueTime: "14:00" },
					"Announce",
				),
				block("codeBlock", { language: "ts" }, "const done = true;"),
			],
			highlightCode: async (code, language) =>
				`<pre class="shiki"><code>${language}:${code}</code></pre>`,
		});

		expect(html).toStartWith("<!doctype html>");
		expect(html).toContain('data-haunter-theme="dracula"');
		expect(html).toContain("--background:#282a36");
		expect(html).toContain("Exported page · Dracula");
		expect(html).toContain('<p class="page-icon" aria-hidden="true">🦇</p>');
		expect(html).toContain(
			'<h2 style="color:#ec4040;background-color:#0b6e99">Priorities</h2>',
		);
		expect(html).toContain(
			'<span style="color:#dfab01;background-color:#6940a5">Highlighted</span>',
		);
		expect(html).toContain("<ul><li>Ship<ul><li>Verify</li></ul></li></ul>");
		expect(html).toContain('class="task checked"');
		expect(html).toContain('datetime="2026-08-01T14:00"');
		expect(html).toContain("typescript:const done = true;");
		expect(html).toContain("script-src 'none'");
	});

	it("escapes content and drops unsafe links", async () => {
		const html = await pageToHtmlDocument({
			title: "</title><script>alert(1)</script>",
			theme,
			content: [
				{
					id: "paragraph",
					type: "paragraph",
					props: {
						textColor: 'red" onmouseover="alert(1)',
					},
					content: [
						{ type: "text", text: "<img onerror=alert(1)>", styles: {} },
						{
							type: "link",
							href: "javascript:alert(1)",
							content: [{ type: "text", text: "unsafe", styles: {} }],
						},
					],
					children: [],
				},
			],
		});

		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("onmouseover");
		expect(html).toContain("&lt;img onerror=alert(1)&gt;unsafe");
	});

	it("renders tables and resolved embedded images", async () => {
		const html = await pageToHtmlDocument({
			title: "Data",
			theme,
			content: [
				{
					id: "table",
					type: "table",
					props: { textColor: "green" },
					content: {
						type: "tableContent",
						columnWidths: [180, undefined],
						headerRows: 1,
						rows: [
							{
								cells: [
									{
										props: { colspan: 2 },
										content: [{ type: "text", text: "Metric", styles: {} }],
									},
								],
							},
							{
								cells: [[{ type: "text", text: "Target", styles: {} }]],
							},
						],
					},
					children: [],
				},
				{
					id: "image",
					type: "image",
					props: { url: "/api/files/image.png", name: "Chart" },
					children: [],
				},
			],
			resolveAssetUrl: () => "data:image/png;base64,AAAA",
		});

		expect(html).toContain('<th colspan="2">Metric</th>');
		expect(html).toContain("<td>Target</td>");
		expect(html).toContain(
			'<table style="color:#6b8b87"><colgroup><col style="width:180px"><col></colgroup>',
		);
		expect(html).toContain(
			".table-scroll{overflow-x:auto;margin:10px 0}table{width:auto;max-width:none",
		);
		expect(html).toContain("--muted-foreground:#bfbfbf");
		expect(html).toContain('src="data:image/png;base64,AAAA"');
		expect(html).toContain('alt="Chart"');
	});

	it("honors linked media previews and visual-media alignment", async () => {
		const html = await pageToHtmlDocument({
			title: "Media",
			theme,
			content: [
				{
					id: "image",
					type: "image",
					props: {
						url: "https://example.com/chart.png",
						name: "Chart",
						textAlignment: "right",
						showPreview: true,
					},
					children: [],
				},
				{
					id: "audio",
					type: "audio",
					props: {
						url: "https://example.com/recording.mp3",
						name: "Recording",
						caption: "Meeting audio",
						showPreview: false,
					},
					children: [],
				},
				{
					id: "video",
					type: "video",
					props: {
						url: "https://example.com/demo.mp4",
						name: "Demo",
						textAlignment: "right",
						showPreview: false,
					},
					children: [],
				},
			],
		});

		expect(html).toContain('<figure data-alignment="right"');
		expect(html).toContain(
			'figure[data-alignment="right"] img,figure[data-alignment="right"] video{margin-left:auto}',
		);
		expect(html).toContain(">Recording</a><span>Meeting audio</span>");
		expect(html).not.toContain("<audio");
		expect(html).toContain('<p class="file" data-alignment="right"');
		expect(html).not.toContain("<video");
	});

	it("preserves toggle lists and custom ordered-list starts", async () => {
		const html = await pageToHtmlDocument({
			title: "Lists",
			theme,
			content: [
				block("numberedListItem", { start: 4 }, "Fourth"),
				block("numberedListItem", {}, "Fifth"),
				block("toggleListItem", {}, "More details", [
					block("paragraph", {}, "Nested content"),
				]),
			],
		});

		expect(html).toContain('<ol start="4"><li>Fourth</li><li>Fifth</li></ol>');
		expect(html).toContain(
			'<ul class="toggle-list"><li><details open><summary>More details</summary><div class="toggle-children"><p>Nested content</p></div></details></li></ul>',
		);
	});

	it("renders page references with their live title and icon", async () => {
		const html = await pageToHtmlDocument({
			title: "References",
			theme,
			sourceUrl: "https://haunter.app/w/workspace/p/current",
			content: [
				{
					id: "mention-paragraph",
					type: "paragraph",
					props: {},
					content: [
						{ type: "text", text: "See ", styles: {} },
						{
							type: "mention",
							props: { pageId: "linked", workspaceId: "workspace" },
						},
					],
					children: [],
				},
				block("pageLink", {
					pageId: "linked",
					workspaceId: "workspace",
				}),
			],
			resolvePageReference: (pageId, workspaceId) =>
				pageId === "linked" && workspaceId === "workspace"
					? { title: "Plans & notes", icon: "🦇" }
					: null,
		});

		expect(html).toContain(
			'<a class="page-reference" href="https://haunter.app/w/workspace/p/linked">🦇 Plans &amp; notes</a>',
		);
		expect(html).toContain(
			'<p class="page-link"><a href="https://haunter.app/w/workspace/p/linked">🦇 Plans &amp; notes</a></p>',
		);
		expect(html).not.toContain("Linked page");
	});
});

describe("pageExportFilename", () => {
	it("uses the same safe stem for Markdown and HTML", () => {
		expect(pageExportFilename("Sprint: 1/2? *Review*", "md")).toBe(
			"Sprint- 1-2- -Review-.md",
		);
		expect(pageExportFilename("Sprint: 1/2? *Review*", "html")).toBe(
			"Sprint- 1-2- -Review-.html",
		);
	});
});
