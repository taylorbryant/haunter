"use client";

import { BlockNoteEditor } from "@blocknote/core";
import { getCollabMode } from "@/features/collab/client/session";
import { pageRoomId } from "@/features/collab/lib/room";
import {
	COLLAB_CONTENT_VERSION_KEY,
	COLLAB_SEEDED_KEY,
	isSameOrNewerContentVersion,
} from "@/features/pages/lib/collab-document";
import { containsBlockId } from "@/features/pages/lib/reconcile-page-link-blocks";
import { createSubpageLinkBlock } from "@/features/pages/lib/subpage-link-block";
import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import { editorSchema } from "./schema";

/** Best-effort real-time mirror of the server append into a seeded Yjs room. */
export async function syncSubpageLinkToCollabRoom(
	parentPageId: string,
	child: Pick<PageMeta, "id" | "workspaceId">,
	parentContentUpdatedAt: string,
): Promise<boolean> {
	const mode = getCollabMode();
	if (!mode) return false;

	const { withSyncedRoom } = await import(
		"@/features/collab/client/liveblocks"
	);
	const result = await withSyncedRoom(
		mode,
		pageRoomId(parentPageId),
		({ doc }) => {
			const fragment = doc.getXmlFragment("blocknote");
			const meta = doc.getMap<unknown>("haunter-meta");
			// Only a completed seed makes the shared document authoritative. BlockNote
			// can materialize an empty paragraph before the database seed runs.
			if (meta.get(COLLAB_SEEDED_KEY) !== true) return false;

			const editor = BlockNoteEditor.create({
				schema: editorSchema,
				collaboration: {
					fragment,
					user: { name: "Haunter", color: "#8b5cf6" },
				},
			});
			try {
				const block = createSubpageLinkBlock(child);
				const exists = containsBlockId(
					editor.document as unknown as BlockJson[],
					block.id,
				);
				const lastBlock = editor.document.at(-1);
				if (!exists && !lastBlock) return false;

				doc.transact(() => {
					if (!exists && lastBlock) {
						editor.insertBlocks([block as never], lastBlock, "after");
					}
					const current = meta.get(COLLAB_CONTENT_VERSION_KEY);
					if (
						typeof current !== "string" ||
						isSameOrNewerContentVersion(parentContentUpdatedAt, current)
					) {
						meta.set(COLLAB_CONTENT_VERSION_KEY, parentContentUpdatedAt);
					}
				});
				return true;
			} finally {
				editor._tiptapEditor.destroy();
			}
		},
	);

	return result === true;
}
