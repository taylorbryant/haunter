import "@beignet/core/server-only";
import { requireActiveWorkspaceId } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	type PageMeta,
	SearchPagesInputSchema,
	SearchPagesOutputSchema,
	type SearchResult,
} from "../schemas";

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

function toResult(page: PageMeta, snippet: string): SearchResult {
	return {
		id: page.id,
		workspaceId: page.workspaceId,
		title: page.title,
		icon: page.icon,
		snippet,
		updatedAt: page.updatedAt,
	};
}

/**
 * Quick-find across the active workspace. The repository returns LIKE
 * candidates over the raw content JSON (which can false-positive on block
 * props), so body matches are re-verified against extracted text.
 */
export const searchPagesUseCase = useCase
	.query("pages.search")
	.input(SearchPagesInputSchema)
	.output(SearchPagesOutputSchema)
	.run(async ({ ctx, input }) => {
		const workspaceId = requireActiveWorkspaceId(ctx);
		const query = input.q.trim();
		const needle = query.toLowerCase();
		if (needle.length < 2) {
			return { items: [] };
		}

		const candidates = await ctx.ports.pages.searchByWorkspace(
			workspaceId,
			query,
			CANDIDATE_LIMIT,
		);

		const titleMatches: SearchResult[] = [];
		const bodyMatches: SearchResult[] = [];

		for (const page of candidates) {
			const searchText = page.searchText;

			if (page.title.toLowerCase().includes(needle)) {
				const lead = searchText;
				const snippet =
					lead.length > LEAD_SNIPPET_LENGTH
						? `${lead.slice(0, LEAD_SNIPPET_LENGTH)}…`
						: lead;
				titleMatches.push(toResult(page, snippet));
				continue;
			}

			const index = searchText.toLowerCase().indexOf(needle);
			if (index >= 0) {
				bodyMatches.push(
					toResult(page, snippetAround(searchText, index, needle.length)),
				);
			}
		}

		return { items: [...titleMatches, ...bodyMatches].slice(0, RESULT_LIMIT) };
	});
