import type { RenderOptions } from "pele";

// Diagram authors control source only. Links and remote images stay disabled in
// private editors, public readers, and exports alike.
export const MERMAID_RENDER_OPTIONS = {
	links: false,
	images: false,
	limit: 20_000,
	outputLimit: 2_000_000,
	maxEdges: 500,
	fontFamily: "Inter, ui-sans-serif, sans-serif",
} satisfies RenderOptions;

export const MERMAID_EXAMPLE =
	"flowchart LR\n  A[Idea] --> B[Plan]\n  B --> C[Build]";

export function codeBlockText(block: { content?: unknown }): string {
	if (!Array.isArray(block.content)) return "";
	return block.content
		.map((node) => (typeof node?.text === "string" ? node.text : ""))
		.join("");
}

export async function renderMermaid(source: string, idPrefix: string) {
	const { renderAsync } = await import("pele/lazy");
	return renderAsync(source, { ...MERMAID_RENDER_OPTIONS, idPrefix });
}
