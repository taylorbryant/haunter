import * as Y from "yjs";
import { PAGE_BODY_FRAGMENT } from "@/features/documents/model";

const MOVES = "haunter-block-moves";

export class DocumentMoveConflictError extends Error {}

function containers(root: Y.XmlFragment) {
	return [...root.createTreeWalker(() => true)].filter(
		(node): node is Y.XmlElement =>
			node instanceof Y.XmlElement && node.nodeName === "blockContainer",
	);
}

export function documentBlockIds(doc: Y.Doc) {
	return new Set(
		containers(doc.getXmlFragment(PAGE_BODY_FRAGMENT))
			.map((node) => node.getAttribute("id"))
			.filter((id): id is string => !!id),
	);
}

export function assertMovePreservesBlocks(
	previousIds: ReadonlySet<string>,
	doc: Y.Doc,
) {
	const retained = documentBlockIds(doc);
	if ([...previousIds].some((id) => !retained.has(id)))
		throw new DocumentMoveConflictError(
			"Concurrent block moves would remove other blocks",
		);
}

function identity(node: Y.XmlElement) {
	const position = Y.createRelativePositionFromTypeIndex(node, 0);
	if (!position.type) throw new Error("Block is not integrated");
	return `${position.type.client}:${position.type.clock}`;
}

/** Record the new XML identities, including descendants whose IDs were retained. */
export function recordBlockMove(doc: Y.Doc, root: Y.XmlElement) {
	const moves = doc.getMap<string>(MOVES);
	for (const node of [root, ...containers(root)]) {
		const id = node.getAttribute("id");
		if (id) moves.set(id, identity(node));
	}
}

/**
 * Run only on an isolated candidate, before validation, broadcast, or commit.
 * Concurrent clone/delete moves can leave two placements of the same block.
 * Collapse identical copies only; divergent drafts must never be discarded.
 */
export function reconcileBlockMoves(doc: Y.Doc): boolean {
	const moves = doc.getMap<string>(MOVES);
	const byId = new Map<string, Y.XmlElement[]>();
	for (const node of containers(doc.getXmlFragment(PAGE_BODY_FRAGMENT))) {
		const id = node.getAttribute("id");
		if (!id || !moves.has(id)) continue;
		const nodes = byId.get(id) ?? [];
		nodes.push(node);
		byId.set(id, nodes);
	}
	let repaired = false;
	const removed = new Set<Y.XmlElement>();
	function visible(node: Y.XmlElement) {
		let ancestor: Y.XmlElement["parent"] = node;
		while (ancestor instanceof Y.XmlElement) {
			if (removed.has(ancestor)) return false;
			ancestor = ancestor.parent;
		}
		return true;
	}
	// Preorder handles whole duplicated subtrees before their descendant IDs.
	for (const [id, entries] of byId) {
		const nodes = entries.filter(visible);
		if (nodes.length < 2) continue;
		const winner =
			nodes.find((node) => identity(node) === moves.get(id)) ??
			nodes.toSorted((a, b) => (identity(a) < identity(b) ? -1 : 1))[0]!;
		if (nodes.some((node) => node.toString() !== winner.toString()))
			throw new DocumentMoveConflictError(
				"Concurrent block moves contain different content",
			);
		for (const node of nodes) {
			if (node === winner) continue;
			const parent = node.parent;
			if (!(parent instanceof Y.XmlElement))
				throw new Error("Invalid moved block parent");
			// Removing a nested group would tombstone future sibling insertions.
			// Keeping an empty one is also unsafe: BlockNote deletes invalid groups.
			if (parent.length === 1 && parent.parent instanceof Y.XmlElement)
				throw new DocumentMoveConflictError(
					"Concurrent block moves would empty a nested group",
				);
			parent.delete(parent.toArray().indexOf(node), 1);
			removed.add(node);
			repaired = true;
		}
	}
	return repaired;
}
