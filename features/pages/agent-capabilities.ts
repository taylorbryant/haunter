import "@beignet/core/server-only";
import { z } from "zod";
import { AGENT_CAPABILITY_DESCRIPTIONS } from "@/features/agents/capability-catalog";
import {
	type BlockJson,
	MAX_INITIAL_PAGE_CONTENT_BLOCKS,
	PAGE_TITLE_MAX_LENGTH,
	PAGE_TITLE_TOO_LONG_MESSAGE,
} from "@/features/pages/schemas";
import { appError } from "@/features/shared/errors";
import { defineAgentCapability } from "@/lib/agent-capabilities";

const WorkspaceInput = z.object({ workspaceId: z.string().min(1) });
const PageInput = WorkspaceInput.extend({ pageId: z.string().uuid() });
const PageMetadataOutput = z.object({
	pageId: z.string().uuid(),
	title: z.string(),
	icon: z.string().nullable(),
	parentPageId: z.string().uuid().nullable(),
	updatedAt: z.string(),
});

async function parseAgentMarkdown(markdown: string): Promise<BlockJson[]> {
	const { MarkdownBlockLimitError, markdownToBlocks } = await import(
		"@/features/pages/lib/markdown"
	);
	try {
		return markdownToBlocks(markdown, {
			maxBlocks: MAX_INITIAL_PAGE_CONTENT_BLOCKS,
		});
	} catch (error) {
		if (error instanceof MarkdownBlockLimitError) {
			throw appError("InvalidPageContent", { message: error.message });
		}
		throw error;
	}
}

export const listPagesCapability = defineAgentCapability("list_pages", {
	description: AGENT_CAPABILITY_DESCRIPTIONS.list_pages,
	input: WorkspaceInput,
	output: z.object({ pages: z.array(PageMetadataOutput) }),
	async handle({ ctx, input }) {
		const { listPagesUseCase } = await import("@/features/pages/use-cases");
		const result = await listPagesUseCase.run({
			ctx,
			input: { workspaceId: input.workspaceId },
		});
		return {
			pages: result.items.map((page) => ({
				pageId: page.id,
				title: page.title,
				icon: page.icon,
				parentPageId: page.parentPageId,
				updatedAt: page.updatedAt,
			})),
		};
	},
});

export const searchPagesCapability = defineAgentCapability("search_pages", {
	description: AGENT_CAPABILITY_DESCRIPTIONS.search_pages,
	input: WorkspaceInput.extend({ query: z.string().min(1).max(200) }),
	output: z.object({
		pages: z.array(z.object({ pageId: z.string().uuid(), title: z.string() })),
	}),
	async handle({ ctx, input }) {
		const { searchPagesUseCase } = await import("@/features/pages/use-cases");
		const result = await searchPagesUseCase.run({
			ctx,
			input: { q: input.query },
		});
		return {
			pages: result.items.map((item) => ({
				pageId: item.id,
				title: item.title,
			})),
		};
	},
});

export const readPageCapability = defineAgentCapability("read_page", {
	description: AGENT_CAPABILITY_DESCRIPTIONS.read_page,
	input: PageInput,
	output: z.object({
		pageId: z.string().uuid(),
		title: z.string(),
		markdown: z.string(),
		updatedAt: z.string(),
	}),
	async handle({ ctx, input }) {
		const [{ getPageUseCase }, { blocksToMarkdown }] = await Promise.all([
			import("@/features/pages/use-cases"),
			import("@/features/pages/lib/markdown"),
		]);
		const page = await getPageUseCase.run({
			ctx,
			input: { id: input.pageId },
		});
		return {
			pageId: page.id,
			title: page.title,
			markdown: blocksToMarkdown(page.content),
			updatedAt: page.updatedAt,
		};
	},
});

export const createPageCapability = defineAgentCapability("create_page", {
	description: AGENT_CAPABILITY_DESCRIPTIONS.create_page,
	input: WorkspaceInput.extend({
		title: z
			.string()
			.trim()
			.min(1)
			.max(PAGE_TITLE_MAX_LENGTH, PAGE_TITLE_TOO_LONG_MESSAGE)
			.describe("The page title, displayed separately above the page body."),
		parentPageId: z.string().uuid().optional(),
		markdown: z
			.string()
			.min(1)
			.max(100_000)
			.optional()
			.describe(
				"The page body in Markdown. Do not repeat the page title as the first heading.",
			),
	}),
	output: z.object({
		pageId: z.string().uuid(),
		title: z.string(),
		parentPageId: z.string().uuid().nullable(),
		updatedAt: z.string(),
	}),
	async handle({ ctx, input }) {
		const initialContent = input.markdown
			? await parseAgentMarkdown(input.markdown)
			: null;
		if (initialContent && initialContent.length === 0) {
			throw appError("InvalidPageContent");
		}
		const { createPageUseCase } = await import("@/features/pages/use-cases");
		const page = await createPageUseCase.run({
			ctx,
			input: {
				workspaceId: input.workspaceId,
				title: input.title,
				...(input.parentPageId ? { parentPageId: input.parentPageId } : {}),
				...(initialContent ? { initialContent } : {}),
			},
		});

		return {
			pageId: page.id,
			title: page.title,
			parentPageId: page.parentPageId,
			updatedAt: page.updatedAt,
		};
	},
});

export const appendToPageCapability = defineAgentCapability("append_to_page", {
	description: AGENT_CAPABILITY_DESCRIPTIONS.append_to_page,
	input: PageInput.extend({ markdown: z.string().min(1).max(100_000) }),
	output: z.object({
		pageId: z.string().uuid(),
		title: z.string(),
		appendedBlocks: z.number().int().min(1),
		updatedAt: z.string(),
	}),
	async handle({ ctx, input }) {
		const { getPageUseCase, savePageContentUseCase } = await import(
			"@/features/pages/use-cases"
		);
		const page = await getPageUseCase.run({
			ctx,
			input: { id: input.pageId },
		});
		// Authorize the target before spending work materializing its append.
		const appended = await parseAgentMarkdown(input.markdown);
		if (appended.length === 0) {
			throw appError("InvalidPageContent");
		}
		const saved = await savePageContentUseCase.run({
			ctx,
			input: {
				id: input.pageId,
				content: [...page.content, ...appended],
				baseUpdatedAt: page.contentUpdatedAt,
			},
		});
		return {
			pageId: page.id,
			title: page.title,
			appendedBlocks: appended.length,
			updatedAt: saved.updatedAt,
		};
	},
});

export const updatePageCapability = defineAgentCapability("update_page", {
	description: AGENT_CAPABILITY_DESCRIPTIONS.update_page,
	input: PageInput.extend({
		title: z
			.string()
			.trim()
			.min(1)
			.max(PAGE_TITLE_MAX_LENGTH, PAGE_TITLE_TOO_LONG_MESSAGE)
			.optional(),
		icon: z.string().max(16).nullable().optional(),
		parentPageId: z.string().uuid().nullable().optional(),
	}).refine(
		(input) =>
			input.title !== undefined ||
			input.icon !== undefined ||
			input.parentPageId !== undefined,
		{ message: "Provide a title, icon, or parentPageId to update." },
	),
	output: PageMetadataOutput,
	async handle({ ctx, input }) {
		const { updatePageUseCase } = await import("@/features/pages/use-cases");
		const page = await updatePageUseCase.run({
			ctx,
			input: {
				id: input.pageId,
				...(input.title !== undefined ? { title: input.title } : {}),
				...(input.icon !== undefined ? { icon: input.icon } : {}),
				...(input.parentPageId !== undefined
					? { parentPageId: input.parentPageId }
					: {}),
			},
		});
		return {
			pageId: page.id,
			title: page.title,
			icon: page.icon,
			parentPageId: page.parentPageId,
			updatedAt: page.updatedAt,
		};
	},
});

export const archivePageCapability = defineAgentCapability("archive_page", {
	description: AGENT_CAPABILITY_DESCRIPTIONS.archive_page,
	input: PageInput,
	output: z.object({
		pageId: z.string().uuid(),
		title: z.string(),
		archived: z.literal(true),
	}),
	async handle({ ctx, input }) {
		const { deletePageUseCase, getPageUseCase } = await import(
			"@/features/pages/use-cases"
		);
		const page = await getPageUseCase.run({
			ctx,
			input: { id: input.pageId },
		});
		await deletePageUseCase.run({ ctx, input: { id: input.pageId } });
		return { pageId: page.id, title: page.title, archived: true as const };
	},
});

export const restorePageCapability = defineAgentCapability("restore_page", {
	description: AGENT_CAPABILITY_DESCRIPTIONS.restore_page,
	input: PageInput,
	output: PageMetadataOutput.extend({ restored: z.literal(true) }),
	async handle({ ctx, input }) {
		const { restorePageUseCase } = await import("@/features/pages/use-cases");
		const page = await restorePageUseCase.run({
			ctx,
			input: { id: input.pageId },
		});
		return {
			pageId: page.id,
			title: page.title,
			icon: page.icon,
			parentPageId: page.parentPageId,
			restored: true as const,
			updatedAt: page.updatedAt,
		};
	},
});

export const pageAgentCapabilities = [
	listPagesCapability,
	searchPagesCapability,
	readPageCapability,
	createPageCapability,
	appendToPageCapability,
	updatePageCapability,
	archivePageCapability,
	restorePageCapability,
] as const;
