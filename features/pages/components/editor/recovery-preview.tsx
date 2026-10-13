"use client";

import { BlockNoteEditor } from "@blocknote/core";
import { yDocToBlocks } from "@blocknote/core/yjs";
import { useMemo } from "react";
import * as Y from "yjs";
import {
	DOCUMENT_META,
	DOCUMENT_SCHEMA_VERSION,
	PAGE_BODY_FRAGMENT,
} from "@/features/documents/model";
import type { BlockJson } from "@/features/pages/schemas";
import ReadOnlyEditor from "./read-only-editor";
import { editorSchema } from "./schema";

const parser = BlockNoteEditor.create({ schema: editorSchema });

export function recoveryPreviewContent(update: Uint8Array): BlockJson[] {
	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, update);
		if (
			doc.getMap(DOCUMENT_META).get("schemaVersion") !== DOCUMENT_SCHEMA_VERSION
		)
			throw new Error("Unsupported document schema");
		for (const node of doc
			.getXmlFragment(PAGE_BODY_FRAGMENT)
			.createTreeWalker(() => true)) {
			if (node instanceof Y.XmlElement && !parser.pmSchema.nodes[node.nodeName])
				throw new Error("Unsupported document node");
		}
		return yDocToBlocks(parser, doc, PAGE_BODY_FRAGMENT) as BlockJson[];
	} finally {
		doc.destroy();
	}
}

export default function RecoveryPreview({ update }: { update: Uint8Array }) {
	const preview = useMemo(() => {
		try {
			return { content: recoveryPreviewContent(update) };
		} catch {
			return { content: null };
		}
	}, [update]);
	if (!preview.content)
		return (
			<p role="alert" className="text-muted-foreground text-sm">
				This copy can’t be previewed. You can still download it or try opening
				it as a new page.
			</p>
		);
	return (
		<ReadOnlyEditor
			key={JSON.stringify(preview.content)}
			content={preview.content}
			historyPreview
		/>
	);
}
