"use client";

import { type Client, createClient } from "@liveblocks/client";
import { LiveblocksYjsProvider } from "@liveblocks/yjs";
import { useEffect, useState } from "react";
import * as Y from "yjs";

/**
 * How this client connects to Liveblocks:
 * - "auth": through POST /api/liveblocks-auth, which checks workspace
 *   membership per room and hands viewers read-only tokens. Requires
 *   LIVEBLOCKS_SECRET_KEY on the server plus NEXT_PUBLIC_LIVEBLOCKS_AUTH=true.
 * - "public": directly with the public key — Liveblocks' prototyping mode.
 *   Anyone holding the (bundled) public key can join any room, so this is
 *   only as private as the room ids; switch to "auth" before inviting
 *   anyone you don't trust.
 * - null: collaboration off; the editor runs exactly as before.
 */
export type CollabMode = "auth" | "public";

export function getCollabMode(): CollabMode | null {
	if (process.env.NEXT_PUBLIC_LIVEBLOCKS_AUTH === "true") return "auth";
	if (process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY) return "public";
	return null;
}

let client: Client | null = null;

function getLiveblocksClient(mode: CollabMode): Client {
	if (!client) {
		client =
			mode === "auth"
				? createClient({ authEndpoint: "/api/liveblocks-auth" })
				: createClient({
						publicApiKey: process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY ?? "",
					});
	}
	return client;
}

export type CollabRoom = {
	doc: Y.Doc;
	provider: LiveblocksYjsProvider;
	/** True once the initial server document has been applied to the doc. */
	synced: boolean;
};

/**
 * Enter a Liveblocks room and bind a fresh Y.Doc to it. Returns null until
 * the room connection exists; `synced` flips once the server state has
 * loaded, which is when the editor may mount (it must know whether the
 * shared doc is empty before deciding to seed it).
 */
export function useCollabRoom(
	roomId: string,
	mode: CollabMode | null,
): CollabRoom | null {
	const [room, setRoom] = useState<CollabRoom | null>(null);

	useEffect(() => {
		if (!mode) return;
		const { room: liveblocksRoom, leave } =
			getLiveblocksClient(mode).enterRoom(roomId);
		const doc = new Y.Doc();
		const provider = new LiveblocksYjsProvider(liveblocksRoom, doc);
		const update = () =>
			setRoom({ doc, provider, synced: provider.synced === true });
		provider.on("synced", update);
		provider.on("sync", update);
		update();

		return () => {
			provider.off("synced", update);
			provider.off("sync", update);
			provider.destroy();
			leave();
			doc.destroy();
			setRoom(null);
		};
	}, [roomId, mode]);

	return mode ? room : null;
}
