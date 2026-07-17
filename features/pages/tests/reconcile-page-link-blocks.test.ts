import { describe, expect, it } from "bun:test";
import { reconcilePageLinkBlocks } from "@/features/pages/lib/reconcile-page-link-blocks";
import type { BlockJson } from "@/features/pages/schemas";

function paragraph(id: string, text: string): BlockJson {
	return {
		id,
		type: "paragraph",
		props: {},
		content: [{ type: "text", text, styles: {} }],
		children: [],
	};
}

function pageLink(id: string, pageId: string): BlockJson {
	return {
		id,
		type: "pageLink",
		props: { pageId, workspaceId: "workspace-1" },
		children: [],
	};
}

describe("reconcilePageLinkBlocks", () => {
	it("merges a server-created page link without replacing local Yjs edits", () => {
		const local = [paragraph("local", "Unsaved collaborative text")];
		const link = pageLink("link", "child-page");
		const authoritative = [paragraph("server", "Older saved text"), link];

		const result = reconcilePageLinkBlocks(local, authoritative);

		expect(result.changed).toBe(true);
		expect(result.blocks).toEqual([local[0], link]);
	});

	it("does not add a page link that already exists anywhere in the document", () => {
		const link = pageLink("link", "child-page");
		const local: BlockJson[] = [
			{
				...paragraph("parent", ""),
				children: [link],
			},
		];

		const result = reconcilePageLinkBlocks(local, [link]);

		expect(result.changed).toBe(false);
		expect(result.blocks).toBe(local);
	});

	it("ignores non-page-link blocks that only exist in the database", () => {
		const local = [paragraph("local", "Local text")];

		const result = reconcilePageLinkBlocks(local, [
			paragraph("server", "Server text"),
		]);

		expect(result.changed).toBe(false);
		expect(result.blocks).toBe(local);
	});
});
