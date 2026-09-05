import { expect, test } from "bun:test";
import { createRecoveryDownload } from "./draft-export";
import type { RegisteredDraft } from "./draft-registry";
function draft(
	type: "page" | "page-title" | "canvas",
	value: unknown,
	id = "page",
) {
	return {
		identity: {
			key: type,
			resourceType: type,
			resourceId: id,
			userId: "owner",
			workspaceId: "workspace",
		},
		getSnapshot: () => ({
			value,
			status: "storage-error",
			dirty: true,
			locallySaved: false,
		}),
	} as RegisteredDraft;
}
test("recovery export includes the in-memory title and text even after storage failed", () => {
	const file = createRecoveryDownload([
		draft("page-title", "Latest title"),
		draft("page", [
			{
				id: "block",
				type: "paragraph",
				props: {},
				content: [
					{ type: "text", text: "Latest unsaved sentence", styles: {} },
				],
				children: [],
			},
		]),
	]);
	expect(file.filename).toBe("Latest title.md");
	expect(file.content).toContain("# Latest title");
	expect(file.content).toContain("Latest unsaved sentence");
});
test("a title-only draft produces a nonempty recovery file", () => {
	expect(
		createRecoveryDownload([draft("page-title", "Recover this title")]).content,
	).toContain("Recover this title");
});
test("embedded canvases and page content survive in a single linked recovery file", () => {
	const snapshot = {
		document: { store: { shape: { text: "Canvas sentence" } } },
	};
	const file = createRecoveryDownload([
		draft("page-title", "With canvas"),
		draft("page", []),
		draft("canvas", snapshot, "canvas-id"),
	]);
	expect(file.filename.endsWith(".json")).toBe(true);
	expect(JSON.parse(file.content)).toMatchObject({
		pages: [{ title: "With canvas" }],
		canvases: [{ id: "canvas-id", snapshot }],
	});
});
