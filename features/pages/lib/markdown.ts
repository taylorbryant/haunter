import type { BlockJson } from "@/features/pages/schemas";
import { normalizeCodeBlockLanguage } from "@/features/pages/lib/code-block-language";

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
		if (styles.code) text = `\`${node.text}\``;
		if (styles.bold) text = `**${text}**`;
		if (styles.italic) text = `*${text}*`;
		if (styles.strike || styles.strikethrough) text = `~~${text}~~`;
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
			return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${inline}`;
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
			return `\`\`\`${language}\n${plainText(block.content)}\n\`\`\``;
		}
		case "callout": {
			const emoji =
				typeof block.props.emoji === "string" ? `${block.props.emoji} ` : "";
			return `> ${emoji}${inline}`;
		}
		case "quote":
			return `> ${inline}`;
		case "divider":
			return "---";
		case "pageLink": {
			const pageId = block.props.pageId;
			return typeof pageId === "string" && pageId.length > 0
				? `[Linked page](${PAGE_URI_PREFIX}${pageId})`
				: "";
		}
		case "image": {
			const url = typeof block.props.url === "string" ? block.props.url : "";
			const caption =
				typeof block.props.caption === "string" ? block.props.caption : "";
			return `![${caption}](${url})`;
		}
		case "canvas":
			return "*(canvas)*";
		case "table":
			return "*(table omitted)*";
		default:
			return `${indent}${inline}`;
	}
}

export function blocksToMarkdown(blocks: BlockJson[]): string {
	const lines: string[] = [];

	function walk(nodes: BlockJson[], depth: number) {
		let ordinal = 0;
		for (const block of nodes) {
			ordinal = block.type === "numberedListItem" ? ordinal + 1 : 0;
			const line = blockToMarkdown(block, "  ".repeat(depth), ordinal || 1);
			if (line.length > 0) lines.push(line);
			if (block.children.length > 0) walk(block.children, depth + 1);
		}
	}

	walk(blocks, 0);
	return lines.join("\n\n");
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

/**
 * Parse a pragmatic markdown subset into Haunter blocks. Two-space
 * indentation nests list items and tasks as children; blockquotes become
 * callouts; unrecognized lines become paragraphs.
 */
export function markdownToBlocks(markdown: string): BlockJson[] {
	const roots: BlockJson[] = [];
	// Indentation stack for nesting list items; stack[d] receives depth-d+1 children.
	let listStack: BlockJson[] = [];
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	let i = 0;

	const push = (block: BlockJson, depth: number) => {
		const parent = depth > 0 ? listStack[depth - 1] : undefined;
		if (parent) parent.children.push(block);
		else roots.push(block);
		listStack = listStack.slice(0, depth);
		listStack[depth] = block;
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
			roots.push(
				makeBlock(
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
			roots.push(makeBlock("divider", {}, undefined));
			i += 1;
			continue;
		}

		const heading = HEADING_LINE.exec(trimmed);
		if (heading) {
			listStack = [];
			roots.push(
				makeBlock(
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
			roots.push(makeBlock("callout", {}, parseInline(parts.join(" "))));
			continue;
		}

		const indentMatch = /^( *)/.exec(raw);
		const depth = Math.floor((indentMatch?.[1].length ?? 0) / 2);

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
				makeBlock(
					"task",
					{ checked: task[1] !== " ", due, dueTime, assignee: "" },
					parseInline(title),
				),
				depth,
			);
			i += 1;
			continue;
		}

		const bullet = BULLET_LINE.exec(trimmed);
		if (bullet) {
			push(makeBlock("bulletListItem", {}, parseInline(bullet[1])), depth);
			i += 1;
			continue;
		}

		const numbered = NUMBERED_LINE.exec(trimmed);
		if (numbered) {
			push(makeBlock("numberedListItem", {}, parseInline(numbered[1])), depth);
			i += 1;
			continue;
		}

		const image = /^!\[([^\]]*)\]\(([^)\s]*)\)$/.exec(trimmed);
		if (image) {
			listStack = [];
			roots.push(
				makeBlock("image", { url: image[2], caption: image[1] }, undefined),
			);
			i += 1;
			continue;
		}

		listStack = [];
		roots.push(makeBlock("paragraph", {}, parseInline(trimmed)));
		i += 1;
	}

	return roots;
}
