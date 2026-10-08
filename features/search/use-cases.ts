import "@beignet/core/server-only";
import { z } from "zod";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { appError } from "@/features/shared/errors";
import type { SearchPosition } from "./ports";
import { searchResultPath } from "./navigation";
import {
	SearchWorkspaceInputSchema,
	SearchWorkspaceOutputSchema,
} from "./schemas";

const CursorSchema = z.object({
	workspaceId: z.string(),
	query: z.string(),
	kind: z.string(),
	after: z.object({
		rank: z.number().int().min(0).max(1),
		updatedAt: z.string(),
		kind: z.enum(["page", "task", "canvas"]),
		id: z.uuid(),
	}),
});

export function searchSnippet(text: string, query: string): string {
	const compact = text.replace(/\s+/g, " ").trim();
	const index = compact.toLowerCase().indexOf(query.toLowerCase());
	const start = Math.max(0, index - 45);
	return `${start ? "…" : ""}${compact.slice(start, start + 160)}${compact.length > start + 160 ? "…" : ""}`;
}

export const searchWorkspaceUseCase = useCase
	.query("search.workspace")
	.input(SearchWorkspaceInputSchema)
	.output(SearchWorkspaceOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);
		const identity = {
			workspaceId: input.workspaceId,
			query: input.query,
			kind: input.kind,
		};
		let after: SearchPosition | undefined;
		if (input.cursor) {
			try {
				const cursor = CursorSchema.parse(
					JSON.parse(Buffer.from(input.cursor, "base64url").toString()),
				);
				if (
					cursor.workspaceId !== identity.workspaceId ||
					cursor.query !== identity.query ||
					cursor.kind !== identity.kind
				)
					throw new Error("Search changed");
				after = cursor.after;
			} catch {
				throw appError("InvalidSearchCursor");
			}
		}
		const rows = await ctx.ports.workspaceSearch.search(scope, {
			...input,
			after,
			limit: input.limit + 1,
		});
		const visible = rows.slice(0, input.limit);
		const last = visible.at(-1);
		return {
			items: visible.map(({ text, rank: _rank, ...row }) => ({
				...row,
				workspaceId: input.workspaceId,
				snippet: searchSnippet(text, input.query),
				path: searchResultPath({ ...row, workspaceId: input.workspaceId }),
			})),
			nextCursor:
				rows.length > input.limit && last
					? Buffer.from(
							JSON.stringify({
								...identity,
								after: {
									rank: last.rank,
									updatedAt: last.updatedAt,
									kind: last.kind,
									id: last.id,
								},
							}),
						).toString("base64url")
					: null,
		};
	});
