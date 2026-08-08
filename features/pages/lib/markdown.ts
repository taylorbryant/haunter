import { normalizeCodeBlockLanguage } from "@/features/pages/lib/code-block-language";
import type { BlockJson } from "@/features/content/schemas";

/**
 * Lossy blocks ⇄ markdown conversion for agent access. Hand-rolled rather
 * than @blocknote/server-util so custom blocks (task, callout, pageLink,
 * divider) convert with fidelity and the module stays framework-free —
 * BlockNote's server editor would pull the React block specs into the auth
 * module graph.
 *
 * Coverage: paragraph, heading, bulletListItem, numberedListItem, task,
 * codeBlock, callout, divider, pageLink, image, quote. Canvases and tables
 * export as placeholders and cannot be authored from markdown.
 */

type InlineNode = {
	type?: string;
	text?: string;
	href?: string;
	styles?: Record<string, unknown>;
	props?: Record<string, unknown>;
	content?: unknown;
};

const PAGE_URI_PREFIX = "haunter://page/";

// ---------------------------------------------------------------------------
// Blocks → markdown
// ---------------------------------------------------------------------------

function escapeInline(text: string): string {
	return text.replace(/([\\`*_[\]])/g, "\\$1");
}

function wrapInlineStyle(text: string, marker: string): string {
	const leadingWhitespace = text.match(/^\s*/)?.[0] ?? "";
	const trailingWhitespace = text.match(/\s*$/)?.[0] ?? "";
	const content = text.slice(
		leadingWhitespace.length,
		text.length - trailingWhitespace.length,
	);
	if (content.length === 0) return text;
	return `${leadingWhitespace}${marker}${content}${marker}${trailingWhitespace}`;
}

function inlineToMarkdown(content: unknown): string {
	if (!Array.isArray(content)) return "";

	let out = "";
	for (const node of content as InlineNode[]) {
		if (node?.type === "link") {
			out += `[${inlineToMarkdown(node.content)}](${node.href ?? ""})`;
			continue;
		}
		if (node?.type === "mention") {
			const pageId = node.props?.pageId;
			out +=
				typeof pageId === "string" && pageId.length > 0
					? `[mention](${PAGE_URI_PREFIX}${pageId})`
					: "";
			continue;
		}
		if (typeof node?.text !== "string") continue;

		let text = escapeInline(node.text);
		const styles = node.styles ?? {};
		if (styles.code) text = wrapInlineStyle(node.text, "`");
		if (styles.bold) text = wrapInlineStyle(text, "**");
		if (styles.italic) text = wrapInlineStyle(text, "*");
		if (styles.strike || styles.strikethrough) {
			text = wrapInlineStyle(text, "~~");
		}
		out += text;
	}
	return out;
}

function plainText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	let out = "";
	for (const node of content as InlineNode[]) {
		if (typeof node?.text === "string") out += node.text;
		else if (node?.content) out += plainText(node.content);
	}
	return out;
}

function blockToMarkdown(
	block: BlockJson,
	indent: string,
	ordinal: number,
): string {
	const inline = inlineToMarkdown(block.content);

	switch (block.type) {
		case "heading": {
			const level =
				typeof block.props.level === "number" ? block.props.level : 1;
			return `${indent}${"#".repeat(Math.min(Math.max(level, 1), 6))} ${inline}`;
		}
		case "bulletListItem":
			return `${indent}- ${inline}`;
		case "numberedListItem":
			return `${indent}${ordinal}. ${inline}`;
		case "task": {
			const box = block.props.checked === true ? "[x]" : "[ ]";
			const dueTime =
				typeof block.props.dueTime === "string" &&
				block.props.dueTime.length > 0
					? ` ${block.props.dueTime}`
					: "";
			const due =
				typeof block.props.due === "string" && block.props.due.length > 0
					? ` (due: ${block.props.due}${dueTime})`
					: "";
			return `${indent}- ${box} ${inline}${due}`;
		}
		case "codeBlock": {
			const language = normalizeCodeBlockLanguage(block.props.language);
			const code = plainText(block.content)
				.split("\n")
				.map((line) => `${indent}${line}`)
				.join("\n");
			return `${indent}\`\`\`${language}\n${code}\n${indent}\`\`\``;
		}
		case "callout": {
			const emoji =
				typeof block.props.emoji === "string" ? `${block.props.emoji} ` : "";
			return `${indent}> ${emoji}${inline}`;
		}
		case "quote":
			return `${indent}> ${inline}`;
		case "divider":
			return `${indent}---`;
		case "pageLink": {
			const pageId = block.props.pageId;
			return typeof pageId === "string" && pageId.length > 0
				? `${indent}[Linked page](${PAGE_URI_PREFIX}${pageId})`
				: "";
		}
		case "image": {
			const url = typeof block.props.url === "string" ? block.props.url : "";
			const caption =
				typeof block.props.caption === "string" ? block.props.caption : "";
			return `${indent}![${caption}](${url})`;
		}
		case "canvas":
			return `${indent}*(canvas)*`;
		case "table":
			return `${indent}*(table omitted)*`;
		default:
			return `${indent}${inline}`;
	}
}

export function blocksToMarkdown(blocks: BlockJson[]): string {
	const renderedBlocks: Array<{ markdown: string; isListItem: boolean }> = [];
	const isListItem = (block: BlockJson) =>
		block.type === "bulletListItem" ||
		block.type === "numberedListItem" ||
		block.type === "task";

	function walk(nodes: BlockJson[], listDepth: number) {
		let ordinal = 0;
		for (const block of nodes) {
			ordinal = block.type === "numberedListItem" ? ordinal + 1 : 0;
			const markdown = blockToMarkdown(
				block,
				"    ".repeat(listDepth),
				ordinal || 1,
			);
			if (markdown.length > 0) {
				renderedBlocks.push({
					markdown,
					isListItem: isListItem(block),
				});
			}
			if (block.children.length > 0) {
				walk(block.children, listDepth + (isListItem(block) ? 1 : 0));
			}
		}
	}

	walk(blocks, 0);
	return renderedBlocks.reduce((markdown, current, index) => {
		if (index === 0) return current.markdown;
		const previous = renderedBlocks[index - 1];
		const separator = previous.isListItem && current.isListItem ? "\n" : "\n\n";
		return `${markdown}${separator}${current.markdown}`;
	}, "");
}

// ---------------------------------------------------------------------------
// Markdown → blocks
// ---------------------------------------------------------------------------

function textNode(text: string, styles: Record<string, boolean>) {
	return {
		type: "text",
		text,
		styles: Object.fromEntries(Object.entries(styles).filter(([, on]) => on)),
	};
}

/**
 * Minimal inline parser: `code`, **bold**, *italic*, ~~strike~~, and
 * [text](url) links. Unmatched delimiters fall through as literal text.
 */
function parseInline(
	src: string,
	styles: Record<string, boolean> = {},
): InlineNode[] {
	const nodes: InlineNode[] = [];
	let plain = "";
	let i = 0;

	const flush = () => {
		if (plain.length > 0) {
			nodes.push(textNode(plain.replace(/\\([\\`*_[\]])/g, "$1"), styles));
			plain = "";
		}
	};

	while (i < src.length) {
		if (src[i] === "\\" && i + 1 < src.length) {
			plain += src.slice(i, i + 2);
			i += 2;
			continue;
		}
		if (src[i] === "`") {
			const end = src.indexOf("`", i + 1);
			if (end > i) {
				flush();
				nodes.push(textNode(src.slice(i + 1, end), { ...styles, code: true }));
				i = end + 1;
				continue;
			}
		}
		if (src.startsWith("**", i)) {
			const end = src.indexOf("**", i + 2);
			if (end > i + 1) {
				flush();
				nodes.push(
					...parseInline(src.slice(i + 2, end), { ...styles, bold: true }),
				);
				i = end + 2;
				continue;
			}
		}
		if (src.startsWith("~~", i)) {
			const end = src.indexOf("~~", i + 2);
			if (end > i + 1) {
				flush();
				nodes.push(
					...parseInline(src.slice(i + 2, end), { ...styles, strike: true }),
				);
				i = end + 2;
				continue;
			}
		}
		if (src[i] === "*" || src[i] === "_") {
			const mark = src[i];
			const end = src.indexOf(mark, i + 1);
			if (end > i + 1) {
				flush();
				nodes.push(
					...parseInline(src.slice(i + 1, end), { ...styles, italic: true }),
				);
				i = end + 1;
				continue;
			}
		}
		if (src[i] === "[") {
			const match = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(src.slice(i));
			if (match) {
				flush();
				nodes.push({
					type: "link",
					href: match[2],
					content: parseInline(match[1], styles),
				});
				i += match[0].length;
				continue;
			}
		}
		plain += src[i];
		i += 1;
	}
	flush();
	return nodes;
}

function makeBlock(
	type: string,
	props: Record<string, unknown>,
	content: unknown,
): BlockJson {
	return { id: crypto.randomUUID(), type, props, content, children: [] };
}

const TASK_LINE = /^- \[([ xX])\] (.*)$/;
const DUE_SUFFIX =
	/\s*\(due:\s*(\d{4}-\d{2}-\d{2})(?:\s+(([01]\d|2[0-3]):[0-5]\d))?\)\s*$/;
const BULLET_LINE = /^[-*] (.*)$/;
const NUMBERED_LINE = /^\d+[.)] (.*)$/;
const HEADING_LINE = /^(#{1,6}) (.*)$/;
const FENCE_LINE = /^```(\S*)\s*$/;

export class MarkdownBlockLimitError extends Error {
	constructor(readonly maxBlocks: number) {
		super(`Markdown may contain at most ${maxBlocks} blocks.`);
		this.name = "MarkdownBlockLimitError";
	}
}

/**
 * Parse a pragmatic markdown subset into Haunter blocks. Increasing
 * indentation nests list items and tasks as children, whether the source uses
 * two or four spaces per level; blockquotes become callouts; unrecognized
 * lines become paragraphs.
 */
export function markdownToBlocks(
	markdown: string,
	options: { maxBlocks?: number } = {},
): BlockJson[] {
	const roots: BlockJson[] = [];
	let blockCount = 0;
	const parsedBlock = (
		type: string,
		props: Record<string, unknown>,
		content: unknown,
	) => {
		blockCount += 1;
		if (options.maxBlocks !== undefined && blockCount > options.maxBlocks) {
			throw new MarkdownBlockLimitError(options.maxBlocks);
		}
		return makeBlock(type, props, content);
	};
	// List stacks retain the indentation column for each nesting level. This
	// accepts older Haunter exports (two spaces per level) as well as portable
	// CommonMark-style exports (four spaces per level).
	let listStack: BlockJson[] = [];
	let listIndents: number[] = [];
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	let i = 0;

	const push = (block: BlockJson, indent: number) => {
		let depth = 0;
		for (let index = 0; index < listIndents.length; index += 1) {
			if (listIndents[index] < indent) depth = index + 1;
		}
		const parent = depth > 0 ? listStack[depth - 1] : undefined;
		if (parent) parent.children.push(block);
		else roots.push(block);
		listStack = listStack.slice(0, depth);
		listIndents = listIndents.slice(0, depth);
		listStack[depth] = block;
		listIndents[depth] = indent;
	};

	while (i < lines.length) {
		const raw = lines[i];
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			i += 1;
			continue;
		}

		const fence = FENCE_LINE.exec(trimmed);
		if (fence) {
			const body: string[] = [];
			i += 1;
			while (i < lines.length && !FENCE_LINE.test(lines[i].trim())) {
				body.push(lines[i]);
				i += 1;
			}
			i += 1; // closing fence
			listStack = [];
			listIndents = [];
			roots.push(
				parsedBlock(
					"codeBlock",
					{
						language: normalizeCodeBlockLanguage(fence[1]),
					},
					[{ type: "text", text: body.join("\n"), styles: {} }],
				),
			);
			continue;
		}

		if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
			listStack = [];
			listIndents = [];
			roots.push(parsedBlock("divider", {}, undefined));
			i += 1;
			continue;
		}

		const heading = HEADING_LINE.exec(trimmed);
		if (heading) {
			listStack = [];
			listIndents = [];
			roots.push(
				parsedBlock(
					"heading",
					{ level: Math.min(heading[1].length, 4) },
					parseInline(heading[2]),
				),
			);
			i += 1;
			continue;
		}

		if (trimmed.startsWith("> ")) {
			// Consecutive quote lines collapse into one callout.
			const parts: string[] = [];
			while (i < lines.length && lines[i].trim().startsWith("> ")) {
				parts.push(lines[i].trim().slice(2));
				i += 1;
			}
			listStack = [];
			listIndents = [];
			roots.push(parsedBlock("callout", {}, parseInline(parts.join(" "))));
			continue;
		}

		const indentMatch = /^( *)/.exec(raw);
		const indent = indentMatch?.[1].length ?? 0;

		const task = TASK_LINE.exec(trimmed);
		if (task) {
			let title = task[2];
			let due = "";
			let dueTime = "";
			const dueMatch = DUE_SUFFIX.exec(title);
			if (dueMatch) {
				due = dueMatch[1];
				dueTime = dueMatch[2] ?? "";
				title = title.slice(0, dueMatch.index);
			}
			push(
				parsedBlock(
					"task",
					{ checked: task[1] !== " ", due, dueTime, assignee: "" },
					parseInline(title),
				),
				indent,
			);
			i += 1;
			continue;
		}

		const bullet = BULLET_LINE.exec(trimmed);
		if (bullet) {
			push(parsedBlock("bulletListItem", {}, parseInline(bullet[1])), indent);
			i += 1;
			continue;
		}

		const numbered = NUMBERED_LINE.exec(trimmed);
		if (numbered) {
			push(
				parsedBlock("numberedListItem", {}, parseInline(numbered[1])),
				indent,
			);
			i += 1;
			continue;
		}

		const image = /^!\[([^\]]*)\]\(([^)\s]*)\)$/.exec(trimmed);
		if (image) {
			listStack = [];
			listIndents = [];
			roots.push(
				parsedBlock("image", { url: image[2], caption: image[1] }, undefined),
			);
			i += 1;
			continue;
		}

		listStack = [];
		listIndents = [];
		roots.push(parsedBlock("paragraph", {}, parseInline(trimmed)));
		i += 1;
	}

	return roots;
}
