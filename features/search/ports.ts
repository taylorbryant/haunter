import type { TenantScope } from "@beignet/core/ports";
import type { SearchResult, SearchWorkspaceInput } from "./schemas";

export type SearchPosition = {
	rank: number;
	updatedAt: string;
	kind: SearchResult["kind"];
	id: string;
};
export type SearchRow = Omit<
	SearchResult,
	"workspaceId" | "snippet" | "path"
> & {
	text: string;
	rank: number;
};
export interface WorkspaceSearchRepository {
	search(
		scope: TenantScope,
		input: Pick<SearchWorkspaceInput, "query" | "kind" | "limit"> & {
			after?: SearchPosition;
		},
	): Promise<SearchRow[]>;
}
