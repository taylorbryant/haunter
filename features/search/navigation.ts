import type { SearchResult } from "./schemas";

export function searchResultPath(
	item: Pick<
		SearchResult,
		"workspaceId" | "kind" | "id" | "pageId" | "shapeId"
	>,
) {
	const root = `/w/${encodeURIComponent(item.workspaceId)}`;
	if (item.kind === "page") return `${root}/p/${item.id}`;
	if (item.kind === "task")
		return `${root}/tasks?filter=all&scope=everyone&taskId=${item.id}`;
	const params = new URLSearchParams();
	if (item.pageId) params.set("canvasId", item.id);
	if (item.shapeId) params.set("shapeId", item.shapeId);
	return `${root}/${item.pageId ? `p/${item.pageId}` : `c/${item.id}`}${params.size ? `?${params}` : ""}`;
}
