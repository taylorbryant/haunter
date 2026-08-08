import { describe, expect, test } from "bun:test";
import {
	buildPageTreeIndex,
	canDropPage,
	getPageDropPlacement,
	getPageDropZone,
} from "@/features/pages/client/page-tree-controller";
import type { PageMeta } from "@/features/pages/schemas";

const now = "2026-08-08T12:00:00.000Z";
const ids = {
	root: "00000000-0000-4000-8000-000000000001",
	child: "00000000-0000-4000-8000-000000000002",
	sibling: "00000000-0000-4000-8000-000000000003",
};

function page(
	id: string,
	position: number,
	parentPageId: string | null = null,
): PageMeta {
	return {
		id,
		userId: "user_1",
		workspaceId: "workspace_1",
		parentPageId,
		title: id,
		icon: null,
		position,
		deletedAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

describe("page tree controller", () => {
	const index = buildPageTreeIndex([
		page(ids.root, 1),
		page(ids.child, 1, ids.root),
		page(ids.sibling, 3),
	]);

	test("builds hierarchy and subtree membership together", () => {
		expect(index.tree.map((node) => node.id)).toEqual([ids.root, ids.sibling]);
		expect(index.nodesById.get(ids.root)?.children[0]?.id).toBe(ids.child);
		expect(index.subtreeIdsById.get(ids.root)).toEqual(
			new Set([ids.root, ids.child]),
		);
	});

	test("rejects self-drops and drops into descendants", () => {
		expect(canDropPage(index, ids.root, ids.root)).toBe(false);
		expect(canDropPage(index, ids.root, ids.child)).toBe(false);
		expect(canDropPage(index, ids.sibling, ids.child)).toBe(true);
		expect(canDropPage(index, "missing", ids.child)).toBe(false);
		expect(canDropPage(index, ids.sibling, "missing")).toBe(false);
	});

	test("calculates stable sibling and child placements", () => {
		expect(
			getPageDropPlacement({
				index,
				draggedId: ids.sibling,
				targetId: ids.child,
				zone: "inside",
			}),
		).toEqual({ parentPageId: ids.child, position: 1 });
		expect(
			getPageDropPlacement({
				index,
				draggedId: ids.child,
				targetId: ids.sibling,
				zone: "before",
			}),
		).toEqual({ parentPageId: null, position: 2 });
	});

	test("maps pointer thirds to before, inside, and after", () => {
		expect(getPageDropZone(10, 0, 100)).toBe("before");
		expect(getPageDropZone(50, 0, 100)).toBe("inside");
		expect(getPageDropZone(90, 0, 100)).toBe("after");
	});
});
