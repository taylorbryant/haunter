import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import {
	isUsableLocalDocument,
	isUsableRemoteDocument,
	localDocumentCacheName,
} from "@/features/collab/client/local-document-cache";
import { documentRoomId, workspaceRoomId } from "@/features/collab/lib/room";
import {
	CANVAS_META_NAME,
	documentCacheEpoch,
	PAGE_META_NAME,
} from "@/features/documents/model";
import { CANVAS_SEEDED_KEY } from "@/features/documents/seed-marker";
import { COLLAB_SEEDED_KEY } from "@/features/pages/lib/collab-document";

const PAGE_ID = "12ee99ea-1755-4f09-8fd0-76fe68d5259d";
const CANVAS_ID = "3664ee73-d5bc-4288-a971-9cc382ebac42";

describe("local collaborative document cache", () => {
	it("isolates cached documents by account and room", () => {
		const roomId = documentRoomId("page", PAGE_ID);
		expect(localDocumentCacheName("user-a", roomId, "epoch-a")).not.toBe(
			localDocumentCacheName("user-b", roomId, "epoch-a"),
		);
		expect(localDocumentCacheName("user-a", roomId, "epoch-a")).not.toBe(
			localDocumentCacheName(
				"user-a",
				documentRoomId("canvas", CANVAS_ID),
				"epoch-a",
			),
		);
		expect(localDocumentCacheName("user:a", roomId, "epoch:a")).toContain(
			"user%3Aa",
		);
	});

	it("starts a fresh cache after the provider document is repaired", () => {
		const roomId = documentRoomId("page", PAGE_ID);
		const base = {
			schemaVersion: 1,
			createdAt: "2026-08-04T00:00:00.000Z",
		};
		const firstEpoch = documentCacheEpoch({
			...base,
			seededAt: "2026-08-04T00:00:01.000Z",
		});
		const repairedEpoch = documentCacheEpoch({
			...base,
			seededAt: "2026-08-04T00:00:02.000Z",
		});
		expect(localDocumentCacheName("user-a", roomId, firstEpoch)).not.toBe(
			localDocumentCacheName("user-a", roomId, repairedEpoch),
		);
	});

	it("rejects empty page caches and accepts server-seeded page caches", () => {
		const roomId = documentRoomId("page", PAGE_ID);
		const doc = new Y.Doc();
		expect(isUsableLocalDocument(roomId, doc)).toBe(false);
		doc.getMap(PAGE_META_NAME).set(COLLAB_SEEDED_KEY, true);
		expect(isUsableLocalDocument(roomId, doc)).toBe(true);
		doc.destroy();
	});

	it("keeps remotely synchronized empty rooms from becoming authoritative", () => {
		const roomId = documentRoomId("page", PAGE_ID);
		const doc = new Y.Doc();
		expect(isUsableRemoteDocument(roomId, doc, true)).toBe(false);
		doc.getMap(PAGE_META_NAME).set(COLLAB_SEEDED_KEY, true);
		expect(isUsableRemoteDocument(roomId, doc, false)).toBe(false);
		expect(isUsableRemoteDocument(roomId, doc, true)).toBe(true);
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
