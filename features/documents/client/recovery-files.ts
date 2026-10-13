"use client";

import { DOCUMENT_SCHEMA_VERSION } from "../model";
import { encodeRecoveryUpdate } from "../update-encoding";
import { readDocumentRecovery } from "./local-store";

export type PageRecoveryIdentity = {
	url: string;
	userId: string;
	workspaceId: string;
	pageId: string;
};

export function pageDocumentStorageKey(options: PageRecoveryIdentity) {
	return JSON.stringify([
		options.url,
		options.userId,
		options.workspaceId,
		options.pageId,
		DOCUMENT_SCHEMA_VERSION,
	]);
}

export function recoveryFile(
	pageId: string,
	generation: number,
	update: Uint8Array,
) {
	return JSON.stringify({
		format: "haunter-draft-recovery",
		version: 1,
		pages: [
			{
				type: "page",
				id: `${pageId}:g${generation}`,
				title: `Recovered page — previous copy ${generation + 1}`,
				content: [],
				collaborativeState: {
					format: "haunter-yjs-v1",
					update: encodeRecoveryUpdate(update),
				},
			},
		],
		canvases: [],
	});
}

export async function downloadPageRecovery(
	options: PageRecoveryIdentity,
	generation: number,
) {
	return recoveryFile(
		options.pageId,
		generation,
		await readDocumentRecovery(pageDocumentStorageKey(options), generation),
	);
}
