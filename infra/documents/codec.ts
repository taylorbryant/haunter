import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYDoc, yDocToBlocks } from "@blocknote/core/yjs";
import * as Y from "yjs";
import {
	DOCUMENT_META,
	DOCUMENT_SCHEMA_VERSION,
	PAGE_BODY_FRAGMENT,
} from "@/features/documents/model";
import type { BlockJson } from "@/features/pages/schemas";
import { normalizeCodeBlockLanguages } from "@/features/pages/lib/code-block-language";
import { serverPageSchema } from "./page-schema";

const editor = BlockNoteEditor.create({ schema: serverPageSchema });

export function seedPageBody(content: BlockJson[]): Y.Doc {
	const blocks = normalizeCodeBlockLanguages(content);
	const doc = blocksToYDoc(
		editor,
		(blocks.length
			? blocks
			: [
					{
						id: crypto.randomUUID(),
						type: "paragraph",
						props: {},
						content: [],
						children: [],
					},
				]) as never,
		PAGE_BODY_FRAGMENT,
	);
	doc.getMap(DOCUMENT_META).set("schemaVersion", DOCUMENT_SCHEMA_VERSION);
	return doc;
}

export function projectPageBody(doc: Y.Doc): BlockJson[] {
	if (
		doc.getMap(DOCUMENT_META).get("schemaVersion") !== DOCUMENT_SCHEMA_VERSION
	)
		throw new Error("Unsupported document schema");
	// The upstream conversion can skip unknown XML nodes. Fail explicitly so a
	// newer/invalid client cannot silently lose content during SQL projection.
	for (const node of doc
		.getXmlFragment(PAGE_BODY_FRAGMENT)
		.createTreeWalker(() => true)) {
		if (node instanceof Y.XmlElement && !editor.pmSchema.nodes[node.nodeName])
			throw new Error("Unsupported document node");
	}
	return yDocToBlocks(editor, doc, PAGE_BODY_FRAGMENT) as BlockJson[];
}
