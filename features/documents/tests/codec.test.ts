import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import type { CanvasSnapshot } from "@/features/canvases/schemas";
import { COLLAB_SEEDED_KEY } from "@/features/pages/lib/collab-document";
import type { Page } from "@/features/pages/schemas";
import {
	appendPageBlocks,
	appendSubpageLink,
	canvasProjectionFromYDoc,
	canvasToYDoc,
	documentStateVector,
	documentUpdate,
	pageProjectionFromYDoc,
	pageToYDoc,
	patchPageTaskBlock,
	replaceCanvasSnapshot,
	replacePageBlocks,
	replacePageTitle,
	yDocFromUpdate,
} from "../codec";
import { CANVAS_META_NAME, PAGE_META_NAME } from "../model";

describe("collaborative document codecs", () => {
	it("round-trips the page title and custom blocks with an atomic seed marker", () => {
		const page = {
			title: "Architecture",
			contentUpdatedAt: "2026-08-01T00:00:00.000Z",
			content: [
				{
					id: "task-1",
					type: "task",
					props: {
						checked: false,
						due: "2026-08-02",
						dueTime: "09:00",
						reminder: "15m",
						assignee: "user-1",
					},
					content: [{ type: "text", text: "Review plan", styles: {} }],
					children: [],
				},
			],
		} as Pick<Page, "title" | "content" | "contentUpdatedAt">;
		const doc = pageToYDoc(page);
		try {
			expect(doc.getMap(PAGE_META_NAME).get(COLLAB_SEEDED_KEY)).toBe(true);
			const projection = pageProjectionFromYDoc(doc);
			expect(projection.title).toBe(page.title);
			expect(projection.content[0]?.type).toBe("task");
			expect(projection.content[0]?.props.due).toBe("2026-08-02");
		} finally {
			doc.destroy();
		}
	});

	it("updates a seeded page document without recreating it", () => {
		const doc = pageToYDoc({
			title: "Original",
			contentUpdatedAt: "2026-08-01T00:00:00.000Z",
			content: [
				{
					id: "task-1",
					type: "task",
					props: {
						checked: false,
						due: "",
						dueTime: "",
						reminder: "",
						assignee: "",
					},
					content: [{ type: "text", text: "Ship it", styles: {} }],
					children: [],
				},
			],
		} as Pick<Page, "title" | "content" | "contentUpdatedAt">);
		try {
			replacePageTitle(doc, "Renamed");
			expect(patchPageTaskBlock(doc, "task-1", { checked: true })).toBe(true);
			expect(
				appendSubpageLink(doc, {
					id: "11111111-1111-4111-8111-111111111111",
					workspaceId: "workspace-1",
				}),
			).toBe(true);
			expect(
				appendSubpageLink(doc, {
					id: "11111111-1111-4111-8111-111111111111",
					workspaceId: "workspace-1",
				}),
			).toBe(false);
			const projection = pageProjectionFromYDoc(doc);
			expect(projection.title).toBe("Renamed");
			expect(projection.content[0]?.props.checked).toBe(true);
			expect(
				projection.content.filter((block) => block.type === "pageLink"),
			).toHaveLength(1);

			replacePageBlocks(doc, []);
			expect(pageProjectionFromYDoc(doc).content).toEqual([]);
		} finally {
			doc.destroy();
		}
	});

	it("merges independent semantic updates without rebuilding the page", () => {
		const source = pageToYDoc({
			title: "Concurrent",
			contentUpdatedAt: "2026-08-01T00:00:00.000Z",
			content: [
				{
					id: "task-1",
					type: "task",
					props: {
						checked: false,
						due: "",
						dueTime: "",
						reminder: "",
						assignee: "",
					},
					content: [{ type: "text", text: "Ship it", styles: {} }],
					children: [],
				},
			],
		} as Pick<Page, "title" | "content" | "contentUpdatedAt">);
		const base = documentUpdate(source);
		const taskWriter = yDocFromUpdate(base);
		const linkWriter = yDocFromUpdate(base);
		try {
			const taskBase = documentStateVector(taskWriter);
			const linkBase = documentStateVector(linkWriter);
			expect(patchPageTaskBlock(taskWriter, "task-1", { checked: true })).toBe(
				true,
			);
			expect(
				appendSubpageLink(linkWriter, {
					id: "11111111-1111-4111-8111-111111111111",
					workspaceId: "workspace-1",
				}),
			).toBe(true);
			Y.applyUpdate(taskWriter, Y.encodeStateAsUpdate(linkWriter, linkBase));
			Y.applyUpdate(linkWriter, Y.encodeStateAsUpdate(taskWriter, taskBase));
			for (const doc of [taskWriter, linkWriter]) {
				const projection = pageProjectionFromYDoc(doc);
				expect(projection.content[0]?.props.checked).toBe(true);
				expect(
					projection.content.some((block) => block.type === "pageLink"),
				).toBe(true);
			}
		} finally {
			source.destroy();
			taskWriter.destroy();
			linkWriter.destroy();
		}
	});

	it("appends blocks without replacing concurrent edits", () => {
		const source = pageToYDoc({
			title: "Concurrent append",
			contentUpdatedAt: "2026-08-01T00:00:00.000Z",
			content: [
				{
					id: "task-1",
					type: "task",
					props: {
						checked: false,
						due: "",
						dueTime: "",
						reminder: "",
						assignee: "",
					},
					content: [{ type: "text", text: "Existing", styles: {} }],
					children: [],
				},
			],
		} as Pick<Page, "title" | "content" | "contentUpdatedAt">);
		const base = documentUpdate(source);
		const taskWriter = yDocFromUpdate(base);
		const appendWriter = yDocFromUpdate(base);
		try {
			const taskBase = documentStateVector(taskWriter);
			const appendBase = documentStateVector(appendWriter);
			expect(patchPageTaskBlock(taskWriter, "task-1", { checked: true })).toBe(
				true,
			);
			expect(
				appendPageBlocks(appendWriter, [
					{
						id: "paragraph-1",
						type: "paragraph",
						props: {},
						content: [{ type: "text", text: "Appended", styles: {} }],
						children: [],
					},
				]),
			).toBe(1);
			Y.applyUpdate(
				taskWriter,
				Y.encodeStateAsUpdate(appendWriter, appendBase),
			);
			Y.applyUpdate(appendWriter, Y.encodeStateAsUpdate(taskWriter, taskBase));
			for (const doc of [taskWriter, appendWriter]) {
				const projection = pageProjectionFromYDoc(doc);
				expect(projection.content[0]?.props.checked).toBe(true);
				expect(projection.content[1]?.content).toEqual([
					{ type: "text", text: "Appended", styles: {} },
				]);
			}
		} finally {
			source.destroy();
			taskWriter.destroy();
			appendWriter.destroy();
		}
	});

	it("round-trips tldraw records and schema", () => {
		const snapshot: CanvasSnapshot = {
			schema: { schemaVersion: 2, sequences: {} },
			store: {
				"shape:one": { id: "shape:one", typeName: "shape", type: "geo" },
			},
		};
		const doc = canvasToYDoc(snapshot);
		try {
			expect(doc.getMap(CANVAS_META_NAME).get("canvasSeeded")).toBe(true);
			expect(canvasProjectionFromYDoc(doc)).toEqual(snapshot);
		} finally {
			doc.destroy();
		}
	});

	it("replaces all persisted canvas records and schema", () => {
		const doc = canvasToYDoc({
			schema: { schemaVersion: 1 },
			store: { old: { id: "old" } },
		});
		try {
			replaceCanvasSnapshot(doc, {
				schema: { schemaVersion: 2 },
				store: { next: { id: "next" } },
			});
			expect(canvasProjectionFromYDoc(doc)).toEqual({
				schema: { schemaVersion: 2 },
				store: { next: { id: "next" } },
			});
		} finally {
			doc.destroy();
		}
	});
});
