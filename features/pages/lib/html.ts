import { COLORS_DARK_MODE_DEFAULT, COLORS_DEFAULT } from "@blocknote/core";
import {
	CODE_BLOCK_LANGUAGES,
	normalizeCodeBlockLanguage,
} from "@/features/pages/lib/code-block-language";
import type { BlockJson } from "@/features/content/schemas";

type InlineNode = {
	type?: string;
	text?: string;
	href?: string;
	styles?: Record<string, unknown>;
	props?: Record<string, unknown>;
	content?: unknown;
};

export type PageHtmlTheme = {
	id: string;
	label: string;
	colorScheme: "light" | "dark";
	themeColor: string;
	background: string;
	foreground: string;
	muted: string;
	mutedForeground: string;
	border: string;
	card: string;
	primary: string;
	destructive: string;
	codeBackground: string;
	codeHeaderBackground: string;
	codeForeground: string;
};

export type PageHtmlExportOptions = {
	title: string;
	icon?: string | null;
	content: BlockJson[];
	theme: PageHtmlTheme;
	sourceUrl?: string;
	resolveAssetUrl?: (url: string) => string;
	resolvePageReference?: (
		pageId: string,
		workspaceId: string,
	) => { title: string; icon?: string | null } | null;
	highlightCode?: (code: string, language: string) => Promise<string | null>;
};

type RenderContext = Pick<
	PageHtmlExportOptions,
	| "sourceUrl"
	| "resolveAssetUrl"
	| "resolvePageReference"
	| "highlightCode"
	| "theme"
>;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function safeCssValue(value: string, fallback: string): string {
	return /[;{}<>"'\r\n]|(?:url|expression)\s*\(|@import/i.test(value)
		? fallback
		: value;
}

function safeUrl(
	value: string,
	baseUrl: string | undefined,
	options: {
		allowMailto?: boolean;
		allowImageData?: boolean;
	} = {},
): string | null {
	if (
		options.allowImageData &&
		/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(value)
	) {
		return value;
	}

	try {
		const url = new URL(value, baseUrl);
		return [
			"http:",
			"https:",
			...(options.allowMailto ? ["mailto:"] : []),
		].includes(url.protocol)
			? url.href
			: null;
	} catch {
		return null;
	}
}

function pageReferenceIdentity(
	props: Record<string, unknown> | undefined,
): { pageId: string; workspaceId: string } | null {
	const pageId = props?.pageId;
	const workspaceId = props?.workspaceId;
	if (typeof pageId !== "string" || typeof workspaceId !== "string") {
		return null;
	}
	if (pageId.length === 0 || workspaceId.length === 0) return null;
	return { pageId, workspaceId };
}

function pageUrl(
	identity: { pageId: string; workspaceId: string } | null,
	sourceUrl: string | undefined,
): string | null {
	if (!identity || !sourceUrl) return null;

	return safeUrl(
		`/w/${encodeURIComponent(identity.workspaceId)}/p/${encodeURIComponent(identity.pageId)}`,
		sourceUrl,
	);
}

function resolvedPageReference(
	identity: { pageId: string; workspaceId: string } | null,
	context: RenderContext,
): { title: string; icon?: string | null } | null {
	if (!identity) return null;
	return (
		context.resolvePageReference?.(identity.pageId, identity.workspaceId) ??
		null
	);
}

function resolvedEditorColor(
	value: unknown,
	kind: "text" | "background",
	context: RenderContext,
): string | null {
	if (typeof value !== "string" || value === "" || value === "default") {
		return null;
	}
	const palette =
		context.theme.colorScheme === "dark"
			? COLORS_DARK_MODE_DEFAULT
			: COLORS_DEFAULT;
	const resolved = palette[value]?.[kind] ?? value;
	return safeCssValue(resolved, "") || null;
}

function contentStyleAttribute(
	values: Record<string, unknown>,
	context: RenderContext,
	options: { alignment?: boolean } = {},
): string {
	const declarations: string[] = [];
	if (options.alignment !== false) {
		const alignment = values.textAlignment;
		if (
			alignment === "center" ||
			alignment === "right" ||
			alignment === "justify"
		) {
			declarations.push(`text-align:${alignment}`);
		}
	}
	const textColor = resolvedEditorColor(values.textColor, "text", context);
	if (textColor) declarations.push(`color:${textColor}`);
	const backgroundColor = resolvedEditorColor(
		values.backgroundColor,
		"background",
		context,
	);
	if (backgroundColor) {
		declarations.push(`background-color:${backgroundColor}`);
	}
	return declarations.length
		? ` style="${escapeHtml(declarations.join(";"))}"`
		: "";
}

function mediaAlignmentAttribute(props: Record<string, unknown>): string {
	return props.textAlignment === "center" || props.textAlignment === "right"
		? ` data-alignment="${props.textAlignment}"`
		: "";
}

function inlineToHtml(content: unknown, context: RenderContext): string {
	if (!Array.isArray(content)) return "";

	let output = "";
	for (const node of content as InlineNode[]) {
		if (node?.type === "link") {
			const body = inlineToHtml(node.content, context);
			const href = safeUrl(node.href ?? "", context.sourceUrl, {
				allowMailto: true,
			});
			output += href
				? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${body}</a>`
				: body;
			continue;
		}
		if (node?.type === "mention") {
			const identity = pageReferenceIdentity(node.props);
			const href = pageUrl(identity, context.sourceUrl);
			const page = resolvedPageReference(identity, context);
			const icon = page?.icon ? `${escapeHtml(page.icon)} ` : "";
			const label = `${icon}${escapeHtml(page ? page.title || "Untitled" : "Linked page")}`;
			output += href
				? `<a class="page-reference" href="${escapeHtml(href)}">${label}</a>`
				: `<span class="page-reference">${label}</span>`;
			continue;
		}
		if (node?.type === "hardBreak") {
			output += "<br>";
			continue;
		}
		if (typeof node?.text !== "string") continue;

		let text = escapeHtml(node.text).replaceAll("\n", "<br>");
		const styles = node.styles ?? {};
		if (styles.code) text = `<code>${text}</code>`;
		if (styles.bold) text = `<strong>${text}</strong>`;
		if (styles.italic) text = `<em>${text}</em>`;
		if (styles.underline) text = `<u>${text}</u>`;
		if (styles.strike || styles.strikethrough) text = `<del>${text}</del>`;
		const colorStyle = contentStyleAttribute(styles, context, {
			alignment: false,
		});
		if (colorStyle) text = `<span${colorStyle}>${text}</span>`;
		output += text;
	}
	return output;
}

function plainText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	let output = "";
	for (const node of content as InlineNode[]) {
		if (typeof node?.text === "string") output += node.text;
		else if (node?.content) output += plainText(node.content);
	}
	return output;
}

function stringProp(props: Record<string, unknown>, key: string): string {
	return typeof props[key] === "string" ? props[key] : "";
}

function numberAttribute(value: unknown, name: string): string {
	return typeof value === "number" &&
		Number.isFinite(value) &&
		value > 0 &&
		value <= 10_000
		? ` ${name}="${Math.round(value)}"`
		: "";
}

function assetUrl(block: BlockJson, context: RenderContext): string | null {
	const raw = stringProp(block.props, "url");
	if (!raw) return null;
	const resolved = context.resolveAssetUrl?.(raw) ?? raw;
	return safeUrl(resolved, context.sourceUrl, {
		allowImageData: block.type === "image",
	});
}

function renderTable(block: BlockJson, context: RenderContext) {
	if (!block.content || typeof block.content !== "object") return "";
	const table = block.content as {
		columnWidths?: Array<number | undefined>;
		rows?: Array<{
			cells?: Array<
				| InlineNode[]
				| {
						props?: Record<string, unknown>;
						content?: unknown;
				  }
			>;
		}>;
		headerRows?: number;
		headerCols?: number;
	};
	if (!Array.isArray(table.rows)) return "";

	const rows = table.rows
		.map((row, rowIndex) => {
			const cells = Array.isArray(row.cells) ? row.cells : [];
			return `<tr>${cells
				.map((cell, columnIndex) => {
					const isHeader =
						rowIndex < (table.headerRows ?? 0) ||
						columnIndex < (table.headerCols ?? 0);
					const tag = isHeader ? "th" : "td";
					const props = Array.isArray(cell) ? {} : (cell.props ?? {});
					const content = Array.isArray(cell) ? cell : cell.content;
					return `<${tag}${numberAttribute(props.colspan, "colspan")}${numberAttribute(props.rowspan, "rowspan")}${contentStyleAttribute(props, context)}>${inlineToHtml(content, context)}</${tag}>`;
				})
				.join("")}</tr>`;
		})
		.join("");
	const columns = table.columnWidths
		?.map((width) =>
			typeof width === "number" &&
			Number.isFinite(width) &&
			width > 0 &&
			width <= 10_000
				? `<col style="width:${Math.round(width)}px">`
				: "<col>",
		)
		.join("");
	const colgroup = columns ? `<colgroup>${columns}</colgroup>` : "";

	return rows
		? `<div class="table-scroll"><table${contentStyleAttribute(block.props, context)}>${colgroup}${rows}</table></div>`
		: "";
}

function renderMedia(block: BlockJson, context: RenderContext) {
	const url = assetUrl(block, context);
	const caption = stringProp(block.props, "caption");
	const name = stringProp(block.props, "name");
	const style = contentStyleAttribute(block.props, context);
	const captionHtml = caption
		? `<figcaption>${escapeHtml(caption)}</figcaption>`
		: "";
	if (!url) {
		return `<p class="placeholder"${style}>${escapeHtml(name || `${block.type} unavailable`)}</p>`;
	}

	if (block.type === "file" || block.props.showPreview === false) {
		const fallbackLabel =
			block.type === "file" ? "Download file" : `Open ${block.type}`;
		return `<p class="file"${mediaAlignmentAttribute(block.props)}${style}><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name || fallbackLabel)}</a>${caption ? `<span>${escapeHtml(caption)}</span>` : ""}</p>`;
	}
	if (block.type === "audio") {
		return `<figure${style}><audio controls preload="metadata" src="${escapeHtml(url)}"></audio>${captionHtml}</figure>`;
	}
	if (block.type === "video") {
		return `<figure${mediaAlignmentAttribute(block.props)}${style}><video controls preload="metadata" src="${escapeHtml(url)}"${numberAttribute(block.props.previewWidth, "width")}></video>${captionHtml}</figure>`;
	}

	return `<figure${mediaAlignmentAttribute(block.props)}${style}><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"${numberAttribute(block.props.previewWidth, "width")}>${captionHtml}</figure>`;
}

async function renderCodeBlock(block: BlockJson, context: RenderContext) {
	const code = plainText(block.content);
	const language = normalizeCodeBlockLanguage(block.props.language) || "text";
	const label =
		CODE_BLOCK_LANGUAGES.find((candidate) => candidate.id === language)
			?.label ?? "Plain Text";
	let highlighted: string | null = null;
	if (context.highlightCode) {
		try {
			highlighted = await context.highlightCode(code, language);
		} catch {
			// A missing grammar should not prevent the user from exporting the page.
		}
	}
	const body = highlighted ?? `<pre><code>${escapeHtml(code)}</code></pre>`;
	return `<section class="code-block"><div class="code-header">${escapeHtml(label)}</div>${body}</section>`;
}

function listKind(
	block: BlockJson,
): "bullet" | "numbered" | "task" | "toggle" | null {
	if (block.type === "bulletListItem") return "bullet";
	if (block.type === "numberedListItem") return "numbered";
	if (block.type === "task") return "task";
	if (block.type === "toggleListItem") return "toggle";
	return null;
}

async function renderListItem(block: BlockJson, context: RenderContext) {
	const nested = block.children.length
		? await renderBlocks(block.children, context)
		: "";
	if (block.type === "toggleListItem") {
		const children = nested
			? `<div class="toggle-children">${nested}</div>`
			: "";
		return `<li${contentStyleAttribute(block.props, context)}><details open><summary>${inlineToHtml(block.content, context)}</summary>${children}</details></li>`;
	}
	if (block.type !== "task") {
		return `<li${contentStyleAttribute(block.props, context)}>${inlineToHtml(block.content, context)}${nested}</li>`;
	}

	const checked = block.props.checked === true;
	const due = stringProp(block.props, "due");
	const dueTime = stringProp(block.props, "dueTime");
	const assignee = stringProp(block.props, "assignee");
	const metadata = [
		assignee ? '<span class="chip">Assigned</span>' : "",
		due
			? `<time class="chip" datetime="${escapeHtml(`${due}${dueTime ? `T${dueTime}` : ""}`)}">${escapeHtml(`${due}${dueTime ? `, ${dueTime}` : ""}`)}</time>`
			: "",
	].join("");

	return `<li class="task${checked ? " checked" : ""}"><span class="checkbox" role="checkbox" aria-checked="${checked}">${checked ? "✓" : ""}</span><span class="task-title">${inlineToHtml(block.content, context)}</span>${metadata ? `<span class="task-meta">${metadata}</span>` : ""}${nested}</li>`;
}

async function renderBlock(block: BlockJson, context: RenderContext) {
	const inline = inlineToHtml(block.content, context);
	let body: string;

	switch (block.type) {
		case "heading": {
			const rawLevel = Number(block.props.level);
			const level = Number.isFinite(rawLevel)
				? Math.min(Math.max(Math.round(rawLevel), 1), 4)
				: 1;
			body = `<h${level}${contentStyleAttribute(block.props, context)}>${inline}</h${level}>`;
			break;
		}
		case "codeBlock":
			body = await renderCodeBlock(block, context);
			break;
		case "callout": {
			const color = stringProp(block.props, "color");
			const colorClass = ["red", "amber", "green", "blue", "purple"].includes(
				color,
			)
				? ` ${color}`
				: "";
			const emoji = stringProp(block.props, "emoji") || "💡";
			body = `<aside class="callout${colorClass}"><span class="callout-icon" aria-hidden="true">${escapeHtml(emoji)}</span><div>${inline}</div></aside>`;
			break;
		}
		case "quote":
			body = `<blockquote${contentStyleAttribute(block.props, context)}>${inline}</blockquote>`;
			break;
		case "divider":
			body = "<hr>";
			break;
		case "pageLink": {
			const identity = pageReferenceIdentity(block.props);
			const href = pageUrl(identity, context.sourceUrl);
			const page = resolvedPageReference(identity, context);
			const icon = page?.icon ? escapeHtml(page.icon) : "▣";
			const label = escapeHtml(page ? page.title || "Untitled" : "Linked page");
			body = href
				? `<p class="page-link"><a href="${escapeHtml(href)}">${icon} ${label}</a></p>`
				: `<p class="page-link">${icon} ${label}</p>`;
			break;
		}
		case "image":
		case "audio":
		case "video":
		case "file":
			body = renderMedia(block, context);
			break;
		case "table":
			body = renderTable(block, context);
			break;
		case "canvas": {
			const sourceHref = safeUrl(context.sourceUrl ?? "", context.sourceUrl);
			body = `<aside class="canvas-placeholder"><strong>Canvas</strong><span>Interactive canvas available in Haunter.</span>${sourceHref ? `<a href="${escapeHtml(sourceHref)}">Open the page</a>` : ""}</aside>`;
			break;
		}
		default:
			body = `<p${contentStyleAttribute(block.props, context)}>${inline || "<br>"}</p>`;
	}

	if (block.children.length === 0) return body;
	return `${body}<div class="block-children">${await renderBlocks(block.children, context)}</div>`;
}

async function renderBlocks(blocks: BlockJson[], context: RenderContext) {
	let output = "";
	let index = 0;
	while (index < blocks.length) {
		const kind = listKind(blocks[index]);
		if (!kind) {
			output += await renderBlock(blocks[index], context);
			index += 1;
			continue;
		}

		const firstListBlock = blocks[index];
		const items: string[] = [];
		while (index < blocks.length && listKind(blocks[index]) === kind) {
			items.push(await renderListItem(blocks[index], context));
			index += 1;
		}
		const tag = kind === "numbered" ? "ol" : "ul";
		const className =
			kind === "task"
				? ' class="task-list"'
				: kind === "toggle"
					? ' class="toggle-list"'
					: "";
		const rawStart = firstListBlock.props.start;
		const start =
			kind === "numbered" &&
			typeof rawStart === "number" &&
			Number.isSafeInteger(rawStart)
				? ` start="${Math.trunc(rawStart)}"`
				: "";
		output += `<${tag}${className}${start}>${items.join("")}</${tag}>`;
	}
	return output;
}

const DOCUMENT_STYLES = `
*{box-sizing:border-box}
:root{--background:THEME_BACKGROUND;--foreground:THEME_FOREGROUND;--muted:THEME_MUTED;--muted-foreground:THEME_MUTED_FOREGROUND;--border:THEME_BORDER;--card:THEME_CARD;--primary:THEME_PRIMARY;--destructive:THEME_DESTRUCTIVE;--code-background:THEME_CODE_BACKGROUND;--code-header:THEME_CODE_HEADER;--code-foreground:THEME_CODE_FOREGROUND;color-scheme:THEME_COLOR_SCHEME}
html,body{min-height:100%;margin:0;background:var(--background);color:var(--foreground)}
body{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
.site-header{display:flex;height:48px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding:0 16px}
.brand{display:inline-flex;align-items:center;gap:8px;color:inherit;font-size:14px;font-weight:600;text-decoration:none}.brand svg{width:20px;height:20px}.export-label{color:var(--muted-foreground);font-size:12px}
main{width:100%;max-width:896px;margin:0 auto;padding:40px 32px 64px}.page-icon{margin:0 54px 4px;font-size:36px;line-height:1.2}.page-title{margin:0 54px 14px;font-size:30px;line-height:1.25;font-weight:700}.content{padding:0 54px;overflow-wrap:anywhere}
.content p{margin:3px 0;min-height:1.5em}.content h1,.content h2,.content h3,.content h4{margin:1.25em 0 .35em;font-weight:700;line-height:1.3}.content h1{font-size:30px}.content h2{font-size:24px}.content h3{font-size:20px}.content h4{font-size:18px}
.content ul,.content ol{margin:4px 0;padding-left:1.65rem}.content li{padding:2px 0}.content li>ul,.content li>ol{margin:1px 0}.block-children{margin-left:1.5rem}
a{color:var(--primary);text-decoration-thickness:1px;text-underline-offset:3px}.page-reference,.page-link{font-weight:600}.page-link{margin:5px 0}
strong{font-weight:700}code{border-radius:4px;background:var(--muted);padding:.12em .32em;font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:.9em}
blockquote{margin:6px 0;border-left:3px solid var(--border);padding:3px 16px;color:var(--muted-foreground)}hr{height:1px;margin:12px 0;border:0;background:var(--border)}
.callout{display:flex;align-items:flex-start;gap:10px;margin:5px 0;border:1px solid var(--border);border-radius:8px;background:color-mix(in oklab,var(--muted) 60%,transparent);padding:10px 12px}.callout.red{border-color:#ef444433;background:#ef44441a}.callout.amber{border-color:#f59e0b40;background:#f59e0b1a}.callout.green{border-color:#22c55e33;background:#22c55e1a}.callout.blue{border-color:#3b82f640;background:#3b82f61a}.callout.purple{border-color:#a855f733;background:#a855f71a}.callout-icon{flex:none;font-size:18px;line-height:24px}
.task-list,.toggle-list{list-style:none;padding-left:0!important}.toggle-list summary{cursor:pointer}.toggle-children{margin-left:1.5rem}.task{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px}.task>ul,.task>ol,.task>.block-children{width:100%;margin-left:24px}.checkbox{display:inline-flex;width:16px;height:16px;flex:none;align-items:center;justify-content:center;margin-top:4px;border:1px solid var(--muted-foreground);border-radius:4px;color:var(--background);font-size:12px;line-height:1}.checked .checkbox{border-color:var(--primary);background:var(--primary)}.task-title{min-width:12rem;flex:1}.checked .task-title{color:var(--muted-foreground);text-decoration:line-through}.task-meta{display:inline-flex;gap:4px;margin-left:auto}.chip{border-radius:6px;background:var(--muted);color:var(--muted-foreground);padding:2px 6px;font-size:12px}
.code-block{overflow:hidden;margin:10px 0;border:1px solid color-mix(in oklab,var(--code-foreground) 14%,transparent);border-radius:8px;background:var(--code-background);color:var(--code-foreground)}.code-header{min-height:36px;border-bottom:1px solid color-mix(in oklab,var(--code-foreground) 10%,transparent);background:var(--code-header);padding:8px 10px;font-family:ui-sans-serif,sans-serif;font-size:14px}.code-block pre,.code-block .shiki{overflow:auto;margin:0!important;background:var(--code-background)!important;padding:16px 24px 24px!important;color:var(--code-foreground);font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:14px;line-height:1.6}.code-block pre code{background:transparent;padding:0;font-size:inherit}
figure{margin:12px 0}figure img,figure video{display:block;max-width:100%;height:auto;border-radius:8px}figure[data-alignment="center"] img,figure[data-alignment="center"] video{margin-inline:auto}figure[data-alignment="right"] img,figure[data-alignment="right"] video{margin-left:auto}figcaption{margin-top:5px;color:var(--muted-foreground);font-size:13px}audio{width:100%}.file{display:flex;flex-direction:column;align-items:flex-start}.file[data-alignment="center"]{align-items:center}.file[data-alignment="right"]{align-items:flex-end}.file span{color:var(--muted-foreground);font-size:13px}
.table-scroll{overflow-x:auto;margin:10px 0}table{width:auto;max-width:none;border-collapse:collapse}th,td{border:1px solid var(--border);padding:8px 10px;text-align:left}th{background:var(--muted);font-weight:600}
.canvas-placeholder,.placeholder{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin:10px 0;border:1px solid var(--border);border-radius:8px;background:var(--card);padding:20px;color:var(--muted-foreground)}.canvas-placeholder strong{color:var(--foreground)}
@media(max-width:640px){main{padding:24px 16px 48px}.page-icon,.page-title,.content{margin-left:0;margin-right:0;padding-left:0;padding-right:0}.page-title{font-size:28px}.task-meta{width:100%;margin-left:24px}}
@media print{.site-header{display:none}main{max-width:none;padding-top:0}.code-block{break-inside:avoid}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;

function themedStyles(theme: PageHtmlTheme): string {
	const replacements: Record<string, string> = {
		THEME_BACKGROUND: safeCssValue(theme.background, "#ffffff"),
		THEME_FOREGROUND: safeCssValue(theme.foreground, "#171717"),
		THEME_MUTED: safeCssValue(theme.muted, "#f5f5f5"),
		THEME_MUTED_FOREGROUND: safeCssValue(theme.mutedForeground, "#737373"),
		THEME_BORDER: safeCssValue(theme.border, "#e5e5e5"),
		THEME_CARD: safeCssValue(theme.card, theme.background),
		THEME_PRIMARY: safeCssValue(theme.primary, theme.foreground),
		THEME_DESTRUCTIVE: safeCssValue(theme.destructive, "#dc2626"),
		THEME_CODE_BACKGROUND: safeCssValue(theme.codeBackground, "#ffffff"),
		THEME_CODE_HEADER: safeCssValue(theme.codeHeaderBackground, "#f6f8fa"),
		THEME_CODE_FOREGROUND: safeCssValue(theme.codeForeground, "#24292e"),
		THEME_COLOR_SCHEME: theme.colorScheme,
	};

	return Object.entries(replacements)
		.sort(([left], [right]) => right.length - left.length)
		.reduce(
			(styles, [token, value]) => styles.replaceAll(token, value),
			DOCUMENT_STYLES,
		);
}

const GHOST_PATH =
	"M4 19.5Q6.7 22 9.3 19.5 12 22 14.7 19.5 17.3 22 20 19.5L20 10C20 5.58 16.42 2 12 2 7.58 2 4 5.58 4 10Z M8.3 10.2a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0z M13.5 10.2a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0z";

export async function pageToHtmlDocument(
	options: PageHtmlExportOptions,
): Promise<string> {
	const title = options.title || "Untitled";
	const content = await renderBlocks(options.content, options);
	const source = safeUrl(options.sourceUrl ?? "", options.sourceUrl);
	const home = source ? new URL(source).origin : null;
	const brand = home
		? `<a class="brand" href="${escapeHtml(home)}">`
		: '<span class="brand">';
	const brandClose = home ? "</a>" : "</span>";

	return `<!doctype html>
<html lang="en" data-haunter-theme="${escapeHtml(options.theme.id)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="${options.theme.colorScheme}">
<meta name="theme-color" content="${escapeHtml(options.theme.themeColor)}">
<meta name="generator" content="Haunter">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; media-src data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; object-src 'none'; script-src 'none'">
<title>${escapeHtml(title)}</title>
<style>${themedStyles(options.theme)}</style>
</head>
<body>
<header class="site-header">${brand}<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${GHOST_PATH}"></path></svg>Haunter${brandClose}<span class="export-label">Exported page · ${escapeHtml(options.theme.label)}</span></header>
<main>${options.icon ? `<p class="page-icon" aria-hidden="true">${escapeHtml(options.icon)}</p>` : ""}<h1 class="page-title">${escapeHtml(title)}</h1><article class="content">${content}</article></main>
</body>
</html>`;
}
