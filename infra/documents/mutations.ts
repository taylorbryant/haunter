import * as Y from "yjs";
import { PAGE_BODY_FRAGMENT } from "@/features/documents/model";
import type { BlockJson } from "@/features/content/schemas";
import { appError } from "@/features/shared/errors";
import { seedPageBody, projectPageBody } from "./codec";

/** Preserve existing CRDT nodes: append new containers without rebuilding the body. */
export function appendDocumentBlocks(doc: Y.Doc, blocks: BlockJson[]) {
	const ids = new Set<string>();
	const visit = (items: BlockJson[], rejectDuplicates: boolean) => {
		for (const block of items) {
			if (rejectDuplicates && ids.has(block.id))
				throw appError("InvalidPageContent", {
					message: "Block IDs must be unique within a page.",
				});
			ids.add(block.id);
			visit(block.children, rejectDuplicates);
		}
	};
	visit(projectPageBody(doc), false);
	visit(blocks, true);
	if (!blocks.length) return;
	const source = seedPageBody(blocks);
	try {
		const body = doc.getXmlFragment(PAGE_BODY_FRAGMENT);
		const group = body.get(0);
		const added = source.getXmlFragment(PAGE_BODY_FRAGMENT).get(0);
		if (!(group instanceof Y.XmlElement) || !(added instanceof Y.XmlElement))
			throw appError("InvalidPageContent");
		const nodes = added.toArray().map((node) => {
			if (!(node instanceof Y.XmlElement)) throw appError("InvalidPageContent");
			return node.clone();
		});
		doc.transact(() => group.insert(group.length, nodes));
	} finally {
		source.destroy();
	}
}

/** Update only the requested attributes, preserving inline text and nested children. */
export function patchDocumentBlockProps(
	doc: Y.Doc,
	input: {
		blockId: string;
		blockType: string;
		props: Record<string, string | boolean | number>;
	},
): boolean {
	for (const node of doc
		.getXmlFragment(PAGE_BODY_FRAGMENT)
		.createTreeWalker(() => true)) {
		if (
			!(node instanceof Y.XmlElement) ||
			node.nodeName !== "blockContainer" ||
			node.getAttribute("id") !== input.blockId
		)
			continue;
		const content = node.get(0);
		if (
			!(content instanceof Y.XmlElement) ||
			content.nodeName !== input.blockType
		)
			return false;
		doc.transact(() => {
			for (const [key, value] of Object.entries(input.props))
				content.setAttribute(key, value as never);
		});
		return true;
	}
	return false;
}
