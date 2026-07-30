import "@beignet/core/server-only";
import { setTimeout as waitForSeed } from "node:timers/promises";
import { createProvider } from "@beignet/core/providers";
import { Liveblocks, LiveblocksError } from "@liveblocks/node";
import { pageRoomId } from "@/features/collab/lib/room";
import {
	queueSubpageLinkInCollabDocument,
	queueTaskBlockPatchInCollabDocument,
} from "@/features/pages/lib/collab-document";
import type { PageCollaborationPort } from "@/features/pages/ports";
import { env } from "@/lib/env";

const SEED_WAIT_ATTEMPTS = 5;
const SEED_WAIT_DELAY_MS = 100;

export const liveblocksPageCollaborationProvider = createProvider()({
	name: "liveblocks-page-collaboration",
	setup() {
		const liveblocks = env.LIVEBLOCKS_SECRET_KEY
			? new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY })
			: null;
		async function publishSeededUpdate(
			pageId: string,
			apply: (
				doc: Parameters<typeof queueSubpageLinkInCollabDocument>[0],
			) => boolean,
		) {
			if (!liveblocks) return;
			// Keep Yjs out of the server render graph when collaboration is off.
			// Loading it eagerly alongside BlockNote's client bundle can evaluate
			// both Yjs module formats during development and break constructor checks.
			const Y = await import("yjs");
			const roomId = pageRoomId(pageId);
			const doc = new Y.Doc();
			try {
				for (let attempt = 0; attempt < SEED_WAIT_ATTEMPTS; attempt += 1) {
					const remoteUpdate =
						await liveblocks.getYjsDocumentAsBinaryUpdate(roomId);
					Y.applyUpdate(doc, new Uint8Array(remoteUpdate));
					const before = Y.encodeStateVector(doc);
					if (apply(doc)) {
						await liveblocks.sendYjsBinaryUpdate(
							roomId,
							Y.encodeStateAsUpdate(doc, before),
						);
						return;
					}
					if (attempt < SEED_WAIT_ATTEMPTS - 1) {
						await waitForSeed(SEED_WAIT_DELAY_MS);
					}
				}
			} catch (error) {
				// No room exists yet: SQLite will seed it with the updated content
				// when the page is first opened.
				if (error instanceof LiveblocksError && error.status === 404) return;
				throw error;
			} finally {
				doc.destroy();
			}
		}

		const pageCollaboration: PageCollaborationPort = {
			async publishSubpageLink(input) {
				await publishSeededUpdate(input.parentPageId, (doc) =>
					queueSubpageLinkInCollabDocument(
						doc,
						input.child,
						input.parentContentUpdatedAt,
					),
				);
			},
			async publishTaskBlockPatch(input) {
				await publishSeededUpdate(input.pageId, (doc) =>
					queueTaskBlockPatchInCollabDocument(
						doc,
						input.blockId,
						input.props,
						input.pageContentUpdatedAt,
					),
				);
			},
		};

		return { ports: { pageCollaboration } };
	},
});
