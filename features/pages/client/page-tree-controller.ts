import type { PageMeta } from "@/features/pages/schemas";

export type PageTreeNode = PageMeta & { children: PageTreeNode[] };
export type PageDropZone = "before" | "after" | "inside";

export type PageTreeIndex = {
	tree: PageTreeNode[];
	nodesById: Map<string, PageTreeNode>;
	orderedIds: string[];
	ranges: Map<string, { start: number; end: number }>;
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

	// Descendants occupy one contiguous interval in preorder, even for a
	// collapsed branch. Record each page once regardless of nesting depth.
	const orderedIds: string[] = [];
	const ranges: PageTreeIndex["ranges"] = new Map();
	const pending = [...tree].reverse();
	while (pending.length) {
		const node = pending.pop()!;
		const start = orderedIds.length;
		orderedIds.push(node.id);
		ranges.set(node.id, { start, end: start + 1 });
		for (let i = node.children.length - 1; i >= 0; i--) {
			pending.push(node.children[i]!);
		}
	}
	for (let i = orderedIds.length - 1; i >= 0; i--) {
		const id = orderedIds[i]!;
		const lastChild = nodes.get(id)!.children.at(-1);
		if (lastChild) ranges.get(id)!.end = ranges.get(lastChild.id)!.end;
	}

	return { tree, nodesById: nodes, orderedIds, ranges };
}

export function pageSubtreeIds(index: PageTreeIndex, id: string): string[] {
	const range = index.ranges.get(id);
	return range ? index.orderedIds.slice(range.start, range.end) : [id];
}

export function canDropPage(
	index: PageTreeIndex,
	draggedId: string | null,
	targetId: string,
): boolean {
	if (!draggedId || draggedId === targetId) return false;
	const dragged = index.ranges.get(draggedId);
	const target = index.ranges.get(targetId);
	return (
		!!dragged &&
		!!target &&
		(target.start < dragged.start || target.start >= dragged.end)
	);
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
