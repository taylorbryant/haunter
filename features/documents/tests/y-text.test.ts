import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import { updateSharedText } from "@/features/documents/y-text";

describe("updateSharedText", () => {
	it("preserves unchanged shared characters during an edit", () => {
		const left = new Y.Doc();
		const right = new Y.Doc();
		const leftTitle = left.getText("title");
		leftTitle.insert(0, "Roadmap");
		Y.applyUpdate(right, Y.encodeStateAsUpdate(left));

		const rightTitle = right.getText("title");
		updateSharedText(leftTitle, "Roadmaps");
		updateSharedText(rightTitle, "Road-map");
		Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
		Y.applyUpdate(right, Y.encodeStateAsUpdate(left));

		expect(leftTitle.toString()).toBe("Road-maps");
		expect(rightTitle.toString()).toBe("Road-maps");
		left.destroy();
		right.destroy();
	});

	it("does not split Unicode characters while finding the shared suffix", () => {
		const doc = new Y.Doc();
		const title = doc.getText("title");
		title.insert(0, "A 👻 note");

		updateSharedText(title, "A new 👻 note");

		expect(title.toString()).toBe("A new 👻 note");
		doc.destroy();
	});
});
