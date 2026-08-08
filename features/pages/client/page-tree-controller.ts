import type { PageMeta } from "@/features/pages/schemas";

export type PageTreeNode = PageMeta & { children: PageTreeNode[] };
export type PageDropZone = "before" | "after" | "inside";

export type PageTreeIndex = {
	tree: PageTreeNode[];
	nodesById: Map<string, PageTreeNode>;
	subtreeIdsById: Map<string, Set<string>>;
};

export function buildPageTreeIndex(pages: PageMeta[]): PageTreeIndex {
	const nodes = new Map<string, PageTreeNode>(
		pages.map((page) => [page.id, { ...page, children: [] }]),
	);
	const tree: PageTreeNode[] = [];

	for (const node of nodes.values()) {
		const parent = node.parentPageId ? nodes.get(node.parentPageId) : null;
		if (parent) parent.children.push(node);
		else tree.push(node);
	}

	const subtreeIdsById = new Map<string, Set<string>>();
	function visit(node: PageTreeNode): Set<string> {
		const ids = new Set<string>([node.id]);
		for (const child of node.children) {
			for (const id of visit(child)) ids.add(id);
		}
		subtreeIdsById.set(node.id, ids);
		return ids;
	}
	for (const node of tree) visit(node);

	return { tree, nodesById: nodes, subtreeIdsById };
}

export function canDropPage(
	index: PageTreeIndex,
	draggedId: string | null,
	targetId: string,
): boolean {
	if (!draggedId || draggedId === targetId) return false;
	if (!index.nodesById.has(draggedId) || !index.nodesById.has(targetId)) {
		return false;
	}
	return !index.subtreeIdsById.get(draggedId)?.has(targetId);
}

export function getPageDropPlacement({
	index,
	draggedId,
	targetId,
	zone,
}: {
	index: PageTreeIndex;
	draggedId: string;
	targetId: string;
	zone: PageDropZone;
}): { parentPageId: string | null; position: number } | null {
	const dragged = index.nodesById.get(draggedId);
	const target = index.nodesById.get(targetId);
	if (!dragged || !target || !canDropPage(index, draggedId, targetId)) {
		return null;
	}

	if (zone === "inside") {
		return {
			parentPageId: target.id,
			position:
				target.children
					.filter((child) => child.id !== draggedId)
					.reduce((max, child) => Math.max(max, child.position), 0) + 1,
		};
	}

	const parentPageId = target.parentPageId;
	const siblings = (
		parentPageId === null
			? index.tree
			: (index.nodesById.get(parentPageId)?.children ?? [])
	).filter((sibling) => sibling.id !== draggedId);
	const targetIndex = siblings.findIndex((sibling) => sibling.id === targetId);
	if (targetIndex === -1) return null;

	if (zone === "before") {
		const previous = siblings[targetIndex - 1];
		return {
			parentPageId,
			position: previous
				? (previous.position + target.position) / 2
				: target.position - 1,
		};
	}

	const next = siblings[targetIndex + 1];
	return {
		parentPageId,
		position: next
			? (target.position + next.position) / 2
			: target.position + 1,
	};
}

export function getPageDropZone(
	pointerY: number,
	rowTop: number,
	rowHeight: number,
): PageDropZone {
	const ratio = rowHeight > 0 ? (pointerY - rowTop) / rowHeight : 0.5;
	if (ratio < 0.3) return "before";
	if (ratio > 0.7) return "after";
	return "inside";
}
