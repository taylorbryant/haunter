import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { checkDocumentAccess } from "@/infra/documents/access";
import { loadPageBody } from "@/infra/documents/persistence";
import { DOCUMENT_SCHEMA_VERSION } from "../model";
import { openDocumentSessionUseCase } from "../use-cases/open-document-session";
import { openCanvasSessionUseCase } from "../use-cases/open-canvas-session";
import { documentFixture, paragraph } from "./helpers";

for (const problem of ["missing", "unsupported schema"] as const) {
	test(`page reads and writes reject ${problem} collaborative state without recreating it`, async () => {
		const f = await documentFixture();
		try {
			const before = await f.database.repositories.pages.findById(
				f.scope,
				f.page.id,
			);
			expect(
				await f.database.repositories.documents.find(f.scope, f.page.id),
			).not.toBeNull();
			if (problem === "missing")
				await f.database.db
					.delete(schema.collaborativeDocuments)
					.where(eq(schema.collaborativeDocuments.pageId, f.page.id));
			else
				await f.database.db
					.update(schema.collaborativeDocuments)
					.set({ schemaVersion: DOCUMENT_SCHEMA_VERSION + 1 })
					.where(eq(schema.collaborativeDocuments.pageId, f.page.id));
			const stored = await f.database.db
				.select()
				.from(schema.collaborativeDocuments);
			const error =
				problem === "missing"
					? "Page body is missing from storage"
					: "Unsupported collaborative document schema";
			await expect(
				loadPageBody(f.ctx, f.workspaceId, f.page.id),
			).rejects.toThrow(error);
			await expect(
				f.database.repositories.documents.restoreBody(f.scope, f.page.id, [
					paragraph("Must not replace the body"),
				]),
			).rejects.toThrow(error);
			await expect(
				f.database.repositories.documents.appendBlocks(f.scope, f.page.id, [
					paragraph("Must not append"),
				]),
			).rejects.toThrow(error);
			if (problem === "missing") {
				await expect(
					checkDocumentAccess(f.grant, f.database.db),
				).rejects.toThrow(error);
				await expect(
					openDocumentSessionUseCase.run({
						ctx: f.ctx,
						input: { id: f.page.id },
					}),
				).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
			}
			expect(
				await f.database.repositories.pages.findById(f.scope, f.page.id),
			).toEqual(before);
			expect(
				await f.database.db.select().from(schema.collaborativeDocuments),
			).toEqual(stored);
		} finally {
			await f.database.close();
		}
	});

	test(`canvas sessions reject ${problem} native rooms without recreating them`, async () => {
		const f = await documentFixture();
		try {
			const canvas = await f.database.repositories.canvases.create(f.scope, {
				userId: f.userId,
				pageId: null,
				title: "Stored canvas",
			});
			expect(
				await f.database.repositories.canvases.findSyncRoom(f.scope, canvas.id),
			).not.toBeNull();
			if (problem === "missing")
				await f.database.db
					.delete(schema.canvasSyncRooms)
					.where(eq(schema.canvasSyncRooms.canvasId, canvas.id));
			else
				await f.database.db
					.update(schema.canvasSyncRooms)
					.set({ schemaVersion: 99 })
					.where(eq(schema.canvasSyncRooms.canvasId, canvas.id));
			const stored = await f.database.db.select().from(schema.canvasSyncRooms);
			const session = openCanvasSessionUseCase.run({
				ctx: f.ctx,
				input: { id: canvas.id },
			});
			if (problem === "missing")
				await expect(session).rejects.toMatchObject({
					code: "INVALID_PAGE_CONTENT",
				});
			else
				await expect(session).rejects.toThrow("Unsupported canvas sync schema");
			expect(
				await f.database.repositories.canvases.findById(f.scope, canvas.id),
			).toEqual(canvas);
			expect(await f.database.db.select().from(schema.canvasSyncRooms)).toEqual(
				stored,
			);
		} finally {
			await f.database.close();
		}
	});
}
