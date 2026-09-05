import { z } from "zod";
import {
	type BlockJson,
	DocumentContentSchema,
} from "@/features/content/schemas";

export type { BlockJson } from "@/features/content/schemas";
export { BlockJsonSchema } from "@/features/content/schemas";

export const PAGE_TITLE_MAX_LENGTH = 300;
export const PAGE_TITLE_TOO_LONG_MESSAGE = `Page titles must be ${PAGE_TITLE_MAX_LENGTH} characters or fewer.`;

export const PageContentSchema = DocumentContentSchema;

export const MAX_INITIAL_PAGE_CONTENT_BYTES = 5_000_000;
export const MAX_INITIAL_PAGE_CONTENT_BLOCKS = 10_000;
export const MAX_INITIAL_PAGE_CONTENT_DEPTH = 64;
const MAX_INITIAL_PAGE_JSON_DEPTH = 128;

function jsonStringByteLength(value: string): number {
	// Opening and closing quotes. Count escapes as JSON.stringify would so the
	// limit describes the actual request/persisted representation, not merely
	// the unescaped text.
	let bytes = 2;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (
			code === 0x22 ||
			code === 0x5c ||
			code === 0x08 ||
			code === 0x09 ||
			code === 0x0a ||
			code === 0x0c ||
			code === 0x0d
		) {
			bytes += 2;
		} else if (code <= 0x1f) bytes += 6;
		else if (code <= 0x7f) bytes += 1;
		else if (code <= 0x7ff) bytes += 2;
		else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			index + 1 < value.length &&
			value.charCodeAt(index + 1) >= 0xdc00 &&
			value.charCodeAt(index + 1) <= 0xdfff
		) {
			bytes += 4;
			index += 1;
		} else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
		else bytes += 3;
	}
	return bytes;
}

function initialContentBoundsIssue(value: unknown): string | null {
	let blockCount = 0;
	const visitBlocks = (blocks: unknown[], depth: number): string | null => {
		if (depth > MAX_INITIAL_PAGE_CONTENT_DEPTH) {
			return `Initial page content may not exceed ${MAX_INITIAL_PAGE_CONTENT_DEPTH} nested block levels.`;
		}
		for (const block of blocks) {
			blockCount += 1;
			if (blockCount > MAX_INITIAL_PAGE_CONTENT_BLOCKS) {
				return `Initial page content may contain at most ${MAX_INITIAL_PAGE_CONTENT_BLOCKS} blocks.`;
			}
			if (typeof block !== "object" || block === null) continue;
			const children = (block as { children?: unknown }).children;
			if (!Array.isArray(children) || children.length === 0) continue;
			const issue = visitBlocks(children, depth + 1);
			if (issue) return issue;
		}
		return null;
	};

	if (Array.isArray(value)) {
		const issue = visitBlocks(value, 1);
		if (issue) return issue;
	}

	const ancestors = new WeakSet<object>();
	let bytes = 0;
	const sizeIssue = () =>
		bytes > MAX_INITIAL_PAGE_CONTENT_BYTES
			? "Initial page content must be 5 MB or smaller."
			: null;
	const visitJson = (current: unknown, depth: number): string | null => {
		if (depth > MAX_INITIAL_PAGE_JSON_DEPTH) {
			return "Initial page content is nested too deeply.";
		}

		if (typeof current === "string") {
			bytes += jsonStringByteLength(current);
			return sizeIssue();
		}
		if (typeof current === "number") {
			bytes += String(current).length;
			return sizeIssue();
		}
		if (typeof current === "boolean") {
			bytes += current ? 4 : 5;
			return sizeIssue();
		}
		if (current === null || current === undefined) {
			bytes += 4;
			return sizeIssue();
		}
		if (typeof current !== "object") {
			bytes += 4;
			return sizeIssue();
		}
		if (ancestors.has(current)) {
			return "Initial page content must be serializable.";
		}

		ancestors.add(current);
		bytes += 2;
		let first = true;
		if (Array.isArray(current)) {
			for (const item of current) {
				if (!first) bytes += 1;
				first = false;
				const issue = sizeIssue() ?? visitJson(item, depth + 1);
				if (issue) return issue;
			}
		} else {
			const record = current as Record<string, unknown>;
			for (const key in record) {
				if (!Object.hasOwn(record, key)) continue;
				if (!first) bytes += 1;
				first = false;
				bytes += jsonStringByteLength(key) + 1;
				const issue = sizeIssue() ?? visitJson(record[key], depth + 1);
				if (issue) return issue;
			}
		}
		ancestors.delete(current);
		return sizeIssue();
	};

	return visitJson(value, 0);
}

const InitialPageContentSchema = z
	.unknown()
	.superRefine((value, ctx) => {
		const issue = initialContentBoundsIssue(value);
		if (issue) ctx.addIssue({ code: "custom", message: issue });
	})
	.pipe(PageContentSchema);

export const PageMetaSchema = z.object({
	id: z.string().uuid(),
	userId: z.string(),
	workspaceId: z.string().min(1),
	parentPageId: z.string().uuid().nullable(),
	title: z.string(),
	icon: z.string().nullable(),
	position: z.number(),
	deletedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export const PageSchema = PageMetaSchema.extend({
	content: PageContentSchema,
	/** Optimistic-concurrency token for the document body only. */
	contentUpdatedAt: z.string().datetime(),
});

export const ListPagesInputSchema = z.object({
	workspaceId: z.string().min(1),
});

export const ListPagesOutputSchema = z.object({
	items: z.array(PageMetaSchema),
});

export const PageNavigationItemSchema = PageMetaSchema.extend({
	favoritedAt: z.string().datetime().nullable(),
	lastViewedAt: z.string().datetime().nullable(),
});

export const PageNavigationOutputSchema = z.object({
	favorites: z.array(PageNavigationItemSchema),
	recents: z.array(PageNavigationItemSchema),
});

export const SetPageFavoriteBodySchema = z.object({
	favorite: z.boolean(),
});

export const SetPageFavoriteOutputSchema = z.object({
	pageId: z.string().uuid(),
	favoritedAt: z.string().datetime().nullable(),
});

export const RecordPageViewOutputSchema = z.object({
	pageId: z.string().uuid(),
	lastViewedAt: z.string().datetime(),
});

export const PageIdInputSchema = z.object({
	id: z.string().uuid(),
});

export const CreatePageInputSchema = z.object({
	workspaceId: z.string().min(1),
	parentPageId: z.string().uuid().optional(),
	title: z.string().max(PAGE_TITLE_MAX_LENGTH, PAGE_TITLE_TOO_LONG_MESSAGE),
	/** Optional initial document used by imports and agent-created pages. */
	initialContent: InitialPageContentSchema.optional(),
	/** Defaults to true; the editor opts out when it inserts at the cursor. */
	appendToParentContent: z.boolean().optional(),
});

export const CreatePageOutputSchema = PageMetaSchema.extend({
	/** Initial document-only optimistic-concurrency token. */
	contentUpdatedAt: z.string().datetime(),
	/** Version containing the automatic parent page-link append, when present. */
	parentContentUpdatedAt: z.string().datetime().nullable(),
});

export const UpdatePageBodySchema = z.object({
	title: z
		.string()
		.max(PAGE_TITLE_MAX_LENGTH, PAGE_TITLE_TOO_LONG_MESSAGE)
		.optional(),
	/** Optional title-specific optimistic-concurrency precondition. */
	baseTitle: z
		.string()
		.max(PAGE_TITLE_MAX_LENGTH, PAGE_TITLE_TOO_LONG_MESSAGE)
		.optional(),
	icon: z.string().max(16).nullable().optional(),
	parentPageId: z.string().uuid().nullable().optional(),
	position: z.number().optional(),
});

export const UpdatePageInputSchema =
	PageIdInputSchema.merge(UpdatePageBodySchema);

export const SavePageContentBodySchema = z.object({
	content: PageContentSchema,
	// Optimistic-concurrency precondition: the contentUpdatedAt the client last saw.
	// When present and stale, the save is rejected with 409 instead of
	// clobbering another member's (or another tab's) edits.
	baseUpdatedAt: z.string().datetime().optional(),
});

export const SavePageContentInputSchema = PageIdInputSchema.merge(
	SavePageContentBodySchema,
);

export const SavePageContentOutputSchema = z.object({
	/** General last-edited timestamp for display and sorting. */
	updatedAt: z.string().datetime(),
	/** Document-only optimistic-concurrency token. */
	contentUpdatedAt: z.string().datetime(),
	tasksChanged: z.boolean(),
	linksChanged: z.boolean(),
});

export const DeletePageOutputSchema = z.void();

export const PageVersionMetaSchema = z.object({
	id: z.string().uuid(),
	pageId: z.string().uuid(),
	title: z.string(),
	icon: z.string().nullable(),
	cause: z.enum(["checkpoint", "restore"]),
	createdBy: z.string(),
	/** Author display name, resolved at read time. */
	createdByName: z.string().nullable(),
	createdAt: z.string().datetime(),
});

export const PageVersionSchema = PageVersionMetaSchema.extend({
	content: PageContentSchema,
});

export const ListPageVersionsOutputSchema = z.object({
	items: z.array(PageVersionMetaSchema),
});

export const PageVersionIdInputSchema = z.object({
	id: z.string().uuid(),
	versionId: z.string().uuid(),
});

export const ListTrashInputSchema = z.object({
	workspaceId: z.string().min(1),
});

export const ListTrashOutputSchema = z.object({
	items: z.array(PageMetaSchema),
});

export const ListBacklinksOutputSchema = z.object({
	items: z.array(PageMetaSchema),
});

export const SearchPagesInputSchema = z.object({
	q: z.string().min(2).max(200),
});

export const SearchResultSchema = z.object({
	id: z.string().uuid(),
	workspaceId: z.string().min(1),
	title: z.string(),
	icon: z.string().nullable(),
	/** Text around the first body match, or the page's opening text. */
	snippet: z.string(),
	updatedAt: z.string().datetime(),
});

export const SearchPagesOutputSchema = z.object({
	items: z.array(SearchResultSchema),
});

export type PageMeta = z.infer<typeof PageMetaSchema>;
export type PageNavigationItem = z.infer<typeof PageNavigationItemSchema>;
export type PageNavigationOutput = z.infer<typeof PageNavigationOutputSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type Page = z.infer<typeof PageSchema>;
export type CreatePageInput = z.infer<typeof CreatePageInputSchema>;
export type CreatePageOutput = z.infer<typeof CreatePageOutputSchema>;
export type UpdatePageInput = z.infer<typeof UpdatePageInputSchema>;
export type SavePageContentInput = z.infer<typeof SavePageContentInputSchema>;
export type PageVersionMeta = z.infer<typeof PageVersionMetaSchema>;
export type PageVersion = z.infer<typeof PageVersionSchema>;
