import "@beignet/core/server-only";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { extractPageText } from "../lib/extract-page-text";
import {
	SearchPagesInputSchema,
	SearchPagesOutputSchema,
	type SearchResult,
} from "../schemas";
import type { Page } from "../schemas";

const CANDIDATE_LIMIT = 100;
const RESULT_LIMIT = 20;
const SNIPPET_RADIUS = 40;
const LEAD_SNIPPET_LENGTH = 80;

function snippetAround(text: string, index: number, matchLength: number) {
	const start = Math.max(0, index - SNIPPET_RADIUS);
	const end = Math.min(text.length, index + matchLength + SNIPPET_RADIUS);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < text.length ? "…" : "";
	return `${prefix}${text.slice(start, end)}${suffix}`;
}

function toResult(
	page: Page,
	workspaceName: string,
	snippet: string,
): SearchResult {
	return {
		id: page.id,
		workspaceId: page.workspaceId,
		workspaceName,
		title: page.title,
		icon: page.icon,
		snippet,
		updatedAt: page.updatedAt,
	};
}

/**
 * Quick-find across all of the user's workspaces. The repository returns
 * LIKE candidates over the raw content JSON (which can false-positive on
 * block props), so body matches are re-verified against extracted text.
 */
export const searchPagesUseCase = useCase
	.query("pages.search")
	.input(SearchPagesInputSchema)
	.output(SearchPagesOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const query = input.q.trim();
		const needle = query.toLowerCase();
		if (needle.length === 0) {
			return { items: [] };
		}

		const [workspaces, candidates] = await Promise.all([
			ctx.ports.workspaces.listByUser(user.id),
			ctx.ports.pages.searchByUser(user.id, query, CANDIDATE_LIMIT),
		]);
		const workspaceNames = new Map(
			workspaces.map((workspace) => [workspace.id, workspace.name]),
		);

		const titleMatches: SearchResult[] = [];
		const bodyMatches: SearchResult[] = [];

		for (const page of candidates) {
			const workspaceName = workspaceNames.get(page.workspaceId) ?? "";
			const blocks = extractPageText(page.content);

			if (page.title.toLowerCase().includes(needle)) {
				const lead = blocks[0]?.text ?? "";
				const snippet =
					lead.length > LEAD_SNIPPET_LENGTH
						? `${lead.slice(0, LEAD_SNIPPET_LENGTH)}…`
						: lead;
				titleMatches.push(toResult(page, workspaceName, snippet));
				continue;
			}

			for (const block of blocks) {
				const index = block.text.toLowerCase().indexOf(needle);
				if (index >= 0) {
					bodyMatches.push(
						toResult(
							page,
							workspaceName,
							snippetAround(block.text, index, needle.length),
						),
					);
					break;
				}
			}
		}

		return { items: [...titleMatches, ...bodyMatches].slice(0, RESULT_LIMIT) };
	});
