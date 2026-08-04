import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import {
	isUsableLocalDocument,
	localDocumentCacheName,
} from "@/features/collab/client/local-document-cache";
import { documentRoomId, workspaceRoomId } from "@/features/collab/lib/room";
import { CANVAS_META_NAME, PAGE_META_NAME } from "@/features/documents/model";
import { CANVAS_SEEDED_KEY } from "@/features/documents/seed-marker";
import { COLLAB_SEEDED_KEY } from "@/features/pages/lib/collab-document";

const PAGE_ID = "12ee99ea-1755-4f09-8fd0-76fe68d5259d";
const CANVAS_ID = "3664ee73-d5bc-4288-a971-9cc382ebac42";

describe("local collaborative document cache", () => {
	it("isolates cached documents by account and room", () => {
		const roomId = documentRoomId("page", PAGE_ID);
		expect(localDocumentCacheName("user-a", roomId)).not.toBe(
			localDocumentCacheName("user-b", roomId),
		);
		expect(localDocumentCacheName("user-a", roomId)).not.toBe(
			localDocumentCacheName("user-a", documentRoomId("canvas", CANVAS_ID)),
		);
		expect(localDocumentCacheName("user:a", roomId)).toContain("user%3Aa");
	});

	it("rejects empty page caches and accepts server-seeded page caches", () => {
		const roomId = documentRoomId("page", PAGE_ID);
		const doc = new Y.Doc();
		expect(isUsableLocalDocument(roomId, doc)).toBe(false);
		doc.getMap(PAGE_META_NAME).set(COLLAB_SEEDED_KEY, true);
		expect(isUsableLocalDocument(roomId, doc)).toBe(true);
		doc.destroy();
	});

	it("recognizes seeded canvas caches but never workspace event rooms", () => {
		const doc = new Y.Doc();
		doc.getMap(CANVAS_META_NAME).set(CANVAS_SEEDED_KEY, true);
		expect(
			isUsableLocalDocument(documentRoomId("canvas", CANVAS_ID), doc),
		).toBe(true);
		expect(isUsableLocalDocument(workspaceRoomId("workspace-a"), doc)).toBe(
			false,
		);
		doc.destroy();
	});
});
