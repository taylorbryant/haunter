import { tableCellRows } from "./table-content";

type InlineNode = {
	text?: string;
	content?: unknown;
};

/** Concatenate plain text from nested BlockNote inline content. */
export function extractInlineText(content: unknown): string {
	if (!Array.isArray(content))
		return tableCellRows(content)
			.map((row) => row.map(extractInlineText).join("\t"))
			.join("\n");

	let text = "";
	for (const node of content as InlineNode[]) {
		if (typeof node?.text === "string") text += node.text;
		else if (node?.content) text += extractInlineText(node.content);
	}
	return text;
}
