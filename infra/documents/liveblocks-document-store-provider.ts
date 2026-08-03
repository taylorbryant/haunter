import "@beignet/core/server-only";
import { createProvider } from "@beignet/core/providers";
import { Liveblocks, LiveblocksError } from "@liveblocks/node";
import { DocumentStoreUnavailableError } from "@/features/documents/errors";
import type { DocumentStorePort } from "@/features/documents/ports";
import { env } from "@/lib/env";

function providerFailure(error: unknown): DocumentStoreUnavailableError {
	return error instanceof DocumentStoreUnavailableError
		? error
		: new DocumentStoreUnavailableError({ cause: error });
}

export const liveblocksDocumentStoreProvider = createProvider()({
	name: "liveblocks-document-store",
	setup() {
		const liveblocks = env.LIVEBLOCKS_SECRET_KEY
			? new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY })
			: null;
		const client = () => {
			if (!liveblocks) throw new DocumentStoreUnavailableError();
			return liveblocks;
		};

		const documentStore: DocumentStorePort = {
			provider: "liveblocks",
			async ensureDocument(input) {
				try {
					await client().getOrCreateRoom(input.documentId, {
						defaultAccesses: [],
						organizationId: input.workspaceId,
						metadata: {
							app: "haunter",
							documentKind: input.kind,
							schema: "v2",
						},
					});
				} catch (error) {
					throw providerFailure(error);
				}
			},
			async readBinaryUpdate(id) {
				try {
					const update = await client().getYjsDocumentAsBinaryUpdate(id);
					return new Uint8Array(update);
				} catch (error) {
					if (error instanceof LiveblocksError && error.status === 404) {
						return null;
					}
					throw providerFailure(error);
				}
			},
			async applyBinaryUpdate(id, update) {
				try {
					await client().sendYjsBinaryUpdate(id, update);
				} catch (error) {
					throw providerFailure(error);
				}
			},
			async deleteDocument(id) {
				try {
					await client().deleteRoom(id);
				} catch (error) {
					if (!(error instanceof LiveblocksError && error.status === 404)) {
						throw providerFailure(error);
					}
				}
			},
		};

		return { ports: { documentStore } };
	},
});
