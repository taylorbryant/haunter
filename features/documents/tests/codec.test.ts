import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { seedPageBody, projectPageBody } from "@/infra/documents/codec";
import type { BlockJson } from "@/features/pages/schemas";
import { createPersistenceReceipt, receiptCoversDocument } from "../receipt";

describe("collaborative document encoding", () => {
	test("retains tables and attachments through binary conversion", () => {
		const blocks: BlockJson[] = [
			{
				id: "table",
				type: "table",
				props: {},
				content: {
					type: "tableContent",
					columnWidths: [180],
					headerRows: 1,
					rows: [
						{
							cells: [
								[{ type: "text", text: "Metric", styles: { bold: true } }],
							],
						},
					],
				},
				children: [],
			},
			{
				id: "image",
				type: "image",
				props: {
					url: "/api/files/image.png",
					name: "Chart",
					caption: "Results",
					previewWidth: 320,
				},
				children: [],
			},
			{
				id: "file",
				type: "file",
				props: { url: "/api/files/example.txt", name: "Example" },
				children: [],
			},
		];
		const doc = seedPageBody(blocks);
		const reloaded = new Y.Doc();
		try {
			Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(doc));
			const result = projectPageBody(reloaded);
			expect(result[1]).toMatchObject(blocks[1]!);
			expect(result[2]).toMatchObject(blocks[2]!);
			expect(result[0]?.id).toBe("table");
			expect(JSON.stringify(result[0]?.content)).toContain("Metric");
			expect(result[0]?.content).toMatchObject({
				columnWidths: [180],
				headerRows: 1,
			});
		} finally {
			doc.destroy();
			reloaded.destroy();
		}
	});
	test("retains stable IDs, nested custom blocks, references, marks, and exact code whitespace", () => {
		const code = "  const x = 1;\n\n\treturn x;\n";
		const blocks: BlockJson[] = [
			{
				id: "heading",
				type: "heading",
				props: { level: 4 },
				content: [{ type: "text", text: "Heading", styles: { bold: true } }],
				children: [],
			},
			{
				id: "code",
				type: "codeBlock",
				props: { language: "javascript" },
				content: [{ type: "text", text: code, styles: {} }],
				children: [],
			},
			{
				id: "callout",
				type: "callout",
				props: { emoji: "💡", color: "blue" },
				content: [
					{
						type: "mention",
						props: { pageId: "reference", workspaceId: "workspace" },
					},
				],
				children: [
					{
						id: "task",
						type: "task",
						props: {
							checked: true,
							due: "2026-09-10",
							dueTime: "12:00",
							reminder: "30",
							assignee: "user",
						},
						content: [{ type: "text", text: "Nested task", styles: {} }],
						children: [],
					},
				],
			},
			{
				id: "canvas",
				type: "canvas",
				props: { canvasId: "canvas-id" },
				children: [],
			},
			{
				id: "page-link",
				type: "pageLink",
				props: { pageId: "other-page", workspaceId: "workspace" },
				children: [],
			},
			{ id: "divider", type: "divider", props: {}, children: [] },
		];
		const initial = seedPageBody(blocks);
		const loaded = new Y.Doc();
		try {
			Y.applyUpdate(loaded, Y.encodeStateAsUpdate(initial));
			const projected = projectPageBody(loaded);
			expect(projected).toMatchObject(blocks);
			expect(projected[1]?.content).toEqual([
				{ type: "text", text: code, styles: {} },
			]);
			const repeated = new Y.Doc();
			Y.applyUpdate(repeated, Y.encodeStateAsUpdate(loaded));
			expect(projectPageBody(repeated)).toEqual(projected);
			repeated.destroy();
		} finally {
			initial.destroy();
			loaded.destroy();
		}
	});
	test("a receipt never acknowledges a newer insertion or a deletion-only update", () => {
		const doc = new Y.Doc();
		try {
			const text = doc.getText("text");
			text.insert(0, "abc");
			const receipt = createPersistenceReceipt(doc);
			expect(receiptCoversDocument(doc, receipt)).toBe(true);
			text.delete(1, 1);
			expect(receiptCoversDocument(doc, receipt)).toBe(false);
			const deleted = createPersistenceReceipt(doc);
			expect(receiptCoversDocument(doc, deleted)).toBe(true);
			text.insert(1, "new");
			expect(receiptCoversDocument(doc, deleted)).toBe(false);
		} finally {
			doc.destroy();
		}
	});
});
