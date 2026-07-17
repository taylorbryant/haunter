import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import {
	COLLAB_CONTENT_VERSION_KEY,
	COLLAB_SEEDED_KEY,
	COLLAB_SUBPAGE_LINKS_KEY,
	isSubpageLinkedCollabEvent,
	queueSubpageLinkInCollabDocument,
} from "@/features/pages/lib/collab-document";

const child = {
	id: "00000000-0000-4000-8000-000000000002",
	workspaceId: "workspace-1",
};

describe("collaborative page document mutations", () => {
	it("does not make an unseeded room authoritative", () => {
		const doc = new Y.Doc();

		expect(
			queueSubpageLinkInCollabDocument(doc, child, "2026-07-16T20:00:00.000Z"),
		).toBe(false);
		expect(doc.getMap(COLLAB_SUBPAGE_LINKS_KEY).size).toBe(0);
		doc.destroy();
	});

	it("queues a durable append instruction in a seeded room", () => {
		const doc = new Y.Doc();
		doc.getMap("haunter-meta").set(COLLAB_SEEDED_KEY, true);

		expect(
			queueSubpageLinkInCollabDocument(doc, child, "2026-07-16T20:00:00.000Z"),
		).toBe(true);
		const event = doc.getMap(COLLAB_SUBPAGE_LINKS_KEY).get(child.id);
		expect(isSubpageLinkedCollabEvent(event)).toBe(true);
		expect(doc.getMap("haunter-meta").get(COLLAB_CONTENT_VERSION_KEY)).toBe(
			"2026-07-16T20:00:00.000Z",
		);
		doc.destroy();
	});

	it("does not regress the room content version", () => {
		const doc = new Y.Doc();
		const meta = doc.getMap("haunter-meta");
		meta.set(COLLAB_SEEDED_KEY, true);
		meta.set(COLLAB_CONTENT_VERSION_KEY, "2026-07-16T21:00:00.000Z");

		queueSubpageLinkInCollabDocument(doc, child, "2026-07-16T20:00:00.000Z");

		expect(meta.get(COLLAB_CONTENT_VERSION_KEY)).toBe(
			"2026-07-16T21:00:00.000Z",
		);
		doc.destroy();
	});
});
