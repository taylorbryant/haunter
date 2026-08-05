import type * as Y from "yjs";
import { parseRoomId } from "@/features/collab/lib/room";
import { isCollaborativeDocumentSeeded } from "@/features/documents/seed-marker";

const LOCAL_DOCUMENT_CACHE_VERSION = 2;

/** Keep local Yjs data isolated by signed-in account. A shared browser may
 * contain several Haunter accounts, and one account must never hydrate
 * another account's document before authorization completes. Page content
 * generations remain isolated inside the room document by their generation-
 * suffixed Yjs roots and authoritative active-generation pointer. The server
 * cache epoch changes whenever a provider document is repaired, so stale Yjs
 * history can never merge into its replacement. */
export function localDocumentCacheName(
	userId: string,
	roomId: string,
	cacheEpoch: string,
): string {
	return `haunter:yjs:v${LOCAL_DOCUMENT_CACHE_VERSION}:${encodeURIComponent(userId)}:${encodeURIComponent(cacheEpoch)}:${roomId}`;
}

/** IndexedDB reports an empty database as synchronized. Only a document that
 * carries Haunter's server-written seed marker can replace the cold skeleton. */
export function isUsableLocalDocument(roomId: string, doc: Y.Doc): boolean {
	const target = parseRoomId(roomId);
	if (!target || target.kind === "workspace") return false;
	return isCollaborativeDocumentSeeded(doc, target.kind);
}

/** A provider can synchronize an empty Yjs document successfully. Treat the
 * remote room as authoritative only when it also contains Haunter's seed
 * marker. */
export function isUsableRemoteDocument(
	roomId: string,
	doc: Y.Doc,
	providerSynced: boolean,
): boolean {
	return providerSynced && isUsableLocalDocument(roomId, doc);
}
