import { normalizeCanvasSnapshot } from "@/features/canvases/lib/document";
import { encodeRecoveryUpdate } from "../update-encoding";
import { expect, test } from "bun:test";
import * as Y from "yjs";
import { importRecoveryUseCase } from "../use-cases/import-recovery";
import { parseRecoveryFile } from "../recovery";
import { seedPageBody, projectPageBody } from "@/infra/documents/codec";
import { loadPageBody } from "@/infra/documents/persistence";
import { documentFixture, paragraph } from "./helpers";

const encode = (doc: Y.Doc) => ({
	format: "haunter-yjs-v1",
	update: encodeRecoveryUpdate(Y.encodeStateAsUpdate(doc)),
});

test("recovery imports binary and legacy pages as independent copies with remapped links and canvases", async () => {
	const f = await documentFixture();
	const binary = seedPageBody([
		paragraph("Local draft survives"),
		{
			id: "code",
			type: "codeBlock",
			props: { language: "javascript" },
			content: [{ type: "text", text: "  const n = 1;\n\n", styles: {} }],
			children: [],
		},
		{
			id: "task",
			type: "task",
			props: { checked: true },
			content: [{ type: "text", text: "Recovered task", styles: {} }],
			children: [],
		},
		{
			id: "link",
			type: "pageLink",
			props: { pageId: "other", workspaceId: "old-workspace" },
			children: [],
		},
		{
			id: "canvas",
			type: "canvas",
			props: { canvasId: "drawing" },
			children: [],
		},
	]);
	try {
		const before = await f.database.repositories.pages.findById(
			f.scope,
			f.page.id,
		);
		const file = JSON.stringify({
			format: "haunter-draft-recovery",
			version: 1,
			pages: [
				{
					id: f.page.id,
					title: "Unsaved title",
					collaborativeState: encode(binary),
				},
				{
					id: "other",
					title: "Old JSON draft",
					content: [paragraph("Legacy text")],
				},
			],
			canvases: [
				{
					id: "drawing",
					snapshot: normalizeCanvasSnapshot({}),
				},
			],
		});
		const result = await importRecoveryUseCase.run({
			ctx: f.ctx,
			input: { workspaceId: f.workspaceId, filename: "recovery.json", file },
		});
		expect(result.pages).toHaveLength(2);
		expect(result.canvasIds).toHaveLength(1);
		expect(result.pages[0]?.id).not.toBe(f.page.id);
		expect(
			await f.database.repositories.pages.findById(f.scope, f.page.id),
		).toEqual(before);
		const recovered = await f.database.repositories.pages.findById(
			f.scope,
			result.pages[0]!.id,
		);
		expect(recovered?.title).toBe("Unsaved title");
		expect(JSON.stringify(recovered?.content)).toContain(
			"  const n = 1;\\n\\n",
		);
		expect(
			recovered?.content.find((block) => block.type === "task")?.props.checked,
		).toBe(true);
		expect(
			recovered?.content.find((block) => block.type === "pageLink")?.props,
		).toMatchObject({
			pageId: result.pages[1]!.id,
			workspaceId: f.workspaceId,
		});
		expect(
			recovered?.content.find((block) => block.type === "canvas")?.props
				.canvasId,
		).toBe(result.canvasIds[0]);
		expect(
			await f.database.repositories.pageLinks.listBacklinkSources(
				f.scope,
				result.pages[1]!.id,
			),
		).toHaveLength(1);
		expect(
			(
				await f.database.repositories.canvases.findById(
					f.scope,
					result.canvasIds[0]!,
				)
			)?.snapshot,
		).toEqual({ ...normalizeCanvasSnapshot({}) });
		const stored = await loadPageBody(
			f.ctx,
			f.workspaceId,
			result.pages[0]!.id,
		);
		const newDoc = new Y.Doc();
		Y.applyUpdate(newDoc, stored.state);
		const originalIds = new Set(
			projectPageBody(binary).map((block) => block.id),
		);
		expect(
			projectPageBody(newDoc).some((block) => originalIds.has(block.id)),
		).toBe(false);
		expect(Y.encodeStateVector(newDoc)).not.toEqual(
			Y.encodeStateVector(binary),
		);
		newDoc.destroy();
	} finally {
		binary.destroy();
		await f.database.close();
	}
});

test("a bare legacy block download can be recovered without replacing the original page", async () => {
	const f = await documentFixture();
	try {
		const result = await importRecoveryUseCase.run({
			ctx: f.ctx,
			input: {
				workspaceId: f.workspaceId,
				filename: "previous-draft.json",
				file: JSON.stringify([paragraph("Older draft")]),
			},
		});
		expect(result.pages[0]?.title).toBe("previous-draft");
		expect(
			await f.database.repositories.pages.listMetaByWorkspace(f.scope),
		).toHaveLength(2);
	} finally {
		await f.database.close();
	}
});

test("invalid binary in a bundle creates no partial pages or canvases", async () => {
	const f = await documentFixture();
	try {
		const file = JSON.stringify({
			format: "haunter-draft-recovery",
			version: 1,
			pages: [
				{ id: "valid", title: "Valid", content: [paragraph("Valid")] },
				{
					id: "invalid",
					collaborativeState: { format: "haunter-yjs-v1", update: [1, 2, 3] },
				},
			],
			canvases: [{ id: "drawing", snapshot: {} }],
		});
		await expect(
			importRecoveryUseCase.run({
				ctx: f.ctx,
				input: { workspaceId: f.workspaceId, filename: "bad.json", file },
			}),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
		expect(
			await f.database.repositories.pages.listMetaByWorkspace(f.scope),
		).toHaveLength(1);
		expect(
			await f.database.repositories.canvases.listStandalone(f.scope),
		).toHaveLength(0);
	} finally {
		await f.database.close();
	}
});

test("recovery parsing rejects unknown formats, unsupported versions, duplicate IDs and oversized input", () => {
	for (const value of [
		{},
		{ format: "haunter-draft-recovery", version: 99, pages: [] },
		{
			format: "haunter-draft-recovery",
			version: 1,
			pages: [{ id: "same" }, { id: "same" }],
		},
		{ format: "haunter-yjs-v1", update: [-1, 256] },
	])
		expect(() => parseRecoveryFile(JSON.stringify(value))).toThrow();
	expect(() => parseRecoveryFile(" ".repeat(5_000_001))).toThrow("5 MB");
});

test("viewers and requests for another workspace cannot recover drafts", async () => {
	for (const role of ["viewer", "owner"]) {
		const f = await documentFixture(role);
		try {
			await expect(
				importRecoveryUseCase.run({
					ctx: f.ctx,
					input: {
						workspaceId: role === "viewer" ? f.workspaceId : "foreign",
						filename: "draft.json",
						file: JSON.stringify([paragraph("private")]),
					},
				}),
			).rejects.toThrow();
			expect(
				await f.database.repositories.pages.listMetaByWorkspace(f.scope),
			).toHaveLength(1);
		} finally {
			await f.database.close();
		}
	}
});

test("a late persistence failure rolls back recovered pages and canvases together", async () => {
	const f = await documentFixture();
	const originalUow = f.ctx.ports.uow;
	const failingUow: typeof originalUow = {
		transaction(work) {
			return originalUow.transaction((tx) =>
				work({
					...tx,
					pages: {
						...tx.pages,
						async restoreContent(...args) {
							await tx.pages.restoreContent(...args);
							throw new Error("Simulated persistence failure");
						},
					},
				}),
			);
		},
	};
	try {
		const file = JSON.stringify({
			format: "haunter-draft-recovery",
			version: 1,
			pages: [{ id: "page", content: [paragraph("Recover me")] }],
			canvases: [{ id: "canvas", snapshot: {} }],
		});
		await expect(
			importRecoveryUseCase.run({
				ctx: {
					...f.ctx,
					gate: f.ctx.gate,
					ports: { ...f.ctx.ports, uow: failingUow },
				},
				input: { workspaceId: f.workspaceId, filename: "draft.json", file },
			}),
		).rejects.toThrow("Simulated persistence failure");
		expect(
			await f.database.repositories.pages.listMetaByWorkspace(f.scope),
		).toHaveLength(1);
		expect(
			await f.database.repositories.canvases.listStandalone(f.scope),
		).toHaveLength(0);
	} finally {
		await f.database.close();
	}
});
