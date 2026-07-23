"use client";

import { normalizeCodeBlockLanguage } from "@/features/pages/lib/code-block-language";
import { pageExportFilename } from "@/features/pages/lib/export-filename";
import {
	type PageHtmlTheme,
	pageToHtmlDocument,
} from "@/features/pages/lib/html";
import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import { APP_THEMES, getAppTheme } from "@/lib/themes";

export function htmlFilenameForPage(title: string): string {
	return pageExportFilename(title, "html");
}

export function pageHtmlSourceUrl(
	origin: string,
	workspaceId: string,
	pageId: string,
): string {
	return new URL(
		`/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(pageId)}`,
		origin,
	).href;
}

const HTML_EXPORT_IMAGE_CONCURRENCY = 4;
const MAX_HTML_EXPORT_IMAGE_BYTES = 50 * 1024 * 1024;
const PRIVATE_FILE_URL_PREFIX = "/api/files/";
const EMBEDDABLE_IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
]);

export class HtmlExportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HtmlExportError";
	}
}

function cssVariable(
	style: CSSStyleDeclaration,
	name: string,
	fallback: string,
) {
	return style.getPropertyValue(name).trim() || fallback;
}

export function resolveHtmlExportTheme(
	resolvedTheme: string | undefined,
	appliedThemeIds: Iterable<string>,
) {
	const appliedThemeIdSet = new Set(appliedThemeIds);
	return (
		APP_THEMES.find((theme) => appliedThemeIdSet.has(theme.id)) ??
		getAppTheme(resolvedTheme) ??
		APP_THEMES[0]
	);
}

function captureTheme(resolvedTheme: string | undefined): PageHtmlTheme {
	const appTheme = resolveHtmlExportTheme(
		resolvedTheme,
		document.documentElement.classList,
	);
	const style = getComputedStyle(document.documentElement);
	return {
		id: appTheme.id,
		label: appTheme.label,
		colorScheme: appTheme.colorScheme,
		themeColor: appTheme.themeColor,
		background: cssVariable(style, "--background", appTheme.preview.background),
		foreground: cssVariable(style, "--foreground", appTheme.preview.foreground),
		muted: cssVariable(
			style,
			"--muted",
			`color-mix(in oklab, ${appTheme.preview.background} 92%, ${appTheme.preview.foreground})`,
		),
		mutedForeground: cssVariable(
			style,
			"--muted-foreground",
			appTheme.preview.foreground,
		),
		border: cssVariable(
			style,
			"--border",
			`color-mix(in oklab, ${appTheme.preview.foreground} 14%, transparent)`,
		),
		card: cssVariable(style, "--card", appTheme.preview.background),
		primary: cssVariable(style, "--primary", appTheme.preview.foreground),
		destructive: cssVariable(style, "--destructive", "#dc2626"),
		codeBackground: cssVariable(
			style,
			"--code-block-background",
			appTheme.syntaxTheme.background,
		),
		codeHeaderBackground: cssVariable(
			style,
			"--code-block-header-background",
			appTheme.syntaxTheme.headerBackground,
		),
		codeForeground: cssVariable(
			style,
			"--code-block-foreground",
			appTheme.syntaxTheme.foreground,
		),
	};
}

function collectImageUrls(blocks: BlockJson[], urls = new Set<string>()) {
	for (const block of blocks) {
		if (
			block.type === "image" &&
			typeof block.props.url === "string" &&
			block.props.url.trim().length > 0
		) {
			urls.add(block.props.url);
		}
		if (block.children.length) collectImageUrls(block.children, urls);
	}
	return urls;
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => resolve(String(reader.result)));
		reader.addEventListener("error", () =>
			reject(reader.error ?? new Error("Could not read image")),
		);
		reader.readAsDataURL(blob);
	});
}

type HtmlImageResolverOptions = {
	baseUrl: string;
	origin: string;
	fetchImage: (url: URL) => Promise<Blob>;
	toDataUrl: (blob: Blob) => Promise<string>;
	concurrency?: number;
	maxBytes?: number;
};

export async function resolveHtmlImageUrls(
	urls: Iterable<string>,
	options: HtmlImageResolverOptions,
) {
	const resolved = new Map<string, string>();
	const imageUrls = Array.from(urls);
	const failures: string[] = [];
	const concurrency = Math.max(
		1,
		Math.floor(options.concurrency ?? HTML_EXPORT_IMAGE_CONCURRENCY),
	);
	const maxBytes = options.maxBytes ?? MAX_HTML_EXPORT_IMAGE_BYTES;
	let totalImageBytes = 0;
	let sizeLimitExceeded = false;
	let nextIndex = 0;

	async function resolveNextImage() {
		while (!sizeLimitExceeded) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= imageUrls.length) return;
			const rawUrl = imageUrls[index];
			let url: URL;
			try {
				url = new URL(rawUrl, options.baseUrl);
			} catch {
				resolved.set(rawUrl, "");
				continue;
			}

			if (
				url.origin !== options.origin ||
				!url.pathname.startsWith(PRIVATE_FILE_URL_PREFIX)
			) {
				resolved.set(rawUrl, url.href);
				continue;
			}

			try {
				const blob = await options.fetchImage(url);
				const contentType = blob.type.split(";", 1)[0].toLowerCase();
				if (!EMBEDDABLE_IMAGE_TYPES.has(contentType)) {
					throw new Error("Image response had an unexpected content type");
				}
				if (totalImageBytes + blob.size > maxBytes) {
					sizeLimitExceeded = true;
					continue;
				}
				totalImageBytes += blob.size;
				resolved.set(rawUrl, await options.toDataUrl(blob));
			} catch {
				failures.push(rawUrl);
			}
		}
	}

	await Promise.all(
		Array.from(
			{
				length: Math.min(concurrency, imageUrls.length),
			},
			resolveNextImage,
		),
	);
	if (sizeLimitExceeded) {
		const formattedLimit =
			maxBytes >= 1024 * 1024
				? `${Math.floor(maxBytes / (1024 * 1024))} MB`
				: `${maxBytes} bytes`;
		throw new HtmlExportError(
			`This page contains more than ${formattedLimit} of images. Remove some images before exporting it as HTML.`,
		);
	}
	if (failures.length > 0) {
		throw new HtmlExportError(
			`Could not include ${failures.length === 1 ? "an image" : `${failures.length} images`} in the HTML export. Check your connection and try again.`,
		);
	}
	return resolved;
}

async function resolveImageUrls(content: BlockJson[], sourceUrl: string) {
	const source = new URL(sourceUrl);
	return resolveHtmlImageUrls(collectImageUrls(content), {
		baseUrl: source.href,
		origin: source.origin,
		async fetchImage(url) {
			const response = await fetch(url, { credentials: "same-origin" });
			if (!response.ok) throw new Error(`Image returned ${response.status}`);
			return response.blob();
		},
		toDataUrl: blobToDataUrl,
	});
}

async function createCodeHighlighter(resolvedTheme: string | undefined) {
	try {
		const { getCodeTheme, getHaunterHighlighter } = await import(
			"@/features/pages/components/editor/code-theme"
		);
		const theme = getCodeTheme(resolvedTheme);
		const highlighter = await getHaunterHighlighter(resolvedTheme);

		return async (code: string, rawLanguage: string) => {
			const language = normalizeCodeBlockLanguage(rawLanguage) || "text";
			if (language === "text") return null;
			if (!highlighter.getLoadedLanguages().includes(language)) {
				await highlighter.loadLanguage(language).catch(() => undefined);
			}
			if (!highlighter.getLoadedLanguages().includes(language)) return null;
			return highlighter.codeToHtml(code, {
				lang: language,
				theme: theme.id,
			});
		};
	} catch {
		return undefined;
	}
}

export async function downloadPageHtml({
	title,
	icon,
	content,
	resolvedTheme,
	sourceUrl,
	pageReferences,
}: {
	title: string;
	icon?: string | null;
	content: BlockJson[];
	resolvedTheme?: string;
	sourceUrl: string;
	pageReferences: Array<
		Pick<PageMeta, "id" | "workspaceId" | "title" | "icon">
	>;
}): Promise<void> {
	// Capture once so a theme change during image/highlighter loading cannot
	// produce a document with one palette and a different syntax theme.
	const theme = captureTheme(resolvedTheme);
	const references = new Map(
		pageReferences.map((page) => [
			`${page.workspaceId}:${page.id}`,
			{ title: page.title, icon: page.icon },
		]),
	);
	const [imageUrls, highlightCode] = await Promise.all([
		resolveImageUrls(content, sourceUrl),
		createCodeHighlighter(theme.id),
	]);
	const html = await pageToHtmlDocument({
		title,
		icon,
		content,
		theme,
		sourceUrl,
		resolveAssetUrl: (url) => imageUrls.get(url) ?? url,
		resolvePageReference: (pageId, workspaceId) =>
			references.get(`${workspaceId}:${pageId}`) ?? null,
		highlightCode,
	});
	const blob = new Blob([html], { type: "text/html;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = htmlFilenameForPage(title);
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
