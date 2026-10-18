import { expect, test } from "bun:test";
import { renderMermaid } from "../lib/mermaid";
import { blocksToMarkdown, markdownToBlocks } from "../lib/markdown";
import { projectPageBody, seedPageBody } from "@/infra/documents/codec";

test.each([
	["flowchart LR\n A[Draft] --> B[Publish]", "flowchart"],
	["sequenceDiagram\n Alice->>Bob: Hello", "sequence"],
	["erDiagram\n USER ||--o{ PAGE : owns", "er"],
] as const)("renders %s", async (source, type) => {
	const result = await renderMermaid(source, "test-diagram");
	expect(result.type).toBe(type);
	expect(result.svg).toContain("<svg");
	expect(result.width).toBeGreaterThan(0);
});

test("Mermaid survives Markdown and collaborative document roundtrips", () => {
	const markdown = "```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n```";
	const blocks = markdownToBlocks(markdown);
	expect(blocks[0].props.language).toBe("mermaid");
	const doc = seedPageBody(blocks);
	try {
		expect(blocksToMarkdown(projectPageBody(doc))).toBe(markdown);
	} finally {
		doc.destroy();
	}
});

test("diagrams cannot execute markup or navigate to source-defined links", async () => {
	const { svg } = await renderMermaid(
		'flowchart LR\n A["<script>alert(1)</script>"] --> B[Done]\n click B "https://example.test"',
		"untrusted",
	);
	expect(svg).not.toContain("<script");
	expect(svg).not.toContain("href=");
	expect(svg).not.toContain("<foreignObject");
	const image = await renderMermaid(
		'flowchart LR\n A@{ img: "https://example.test/image.png", label: "Photo", pos: "t", w: 60, h: 60 } --> B',
		"remote-image",
	);
	expect(image.svg).not.toContain("<image");
});

test("invalid and oversized diagrams fail without changing the source", async () => {
	await expect(renderMermaid("not a diagram", "invalid")).rejects.toThrow();
	await expect(
		renderMermaid(`flowchart LR\n A[${"x".repeat(20_000)}]`, "large"),
	).rejects.toThrow();
});
