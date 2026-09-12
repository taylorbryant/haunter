import { seedFixtureBody } from "@/features/documents/tests/helpers";
import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { loadPageBody, persistPageBody } from "@/infra/documents/persistence";
import { projectPageBody } from "@/infra/documents/codec";
import { documentFixture, firstText } from "./helpers";

describe("authoritative page body persistence", () => {
	test("projects collaborative task and backlink additions and removals", async () => {
		const f = await documentFixture();
		const doc = new Y.Doc();
		try {
			const target = await f.database.repositories.pages.create(f.scope, {
				userId: f.userId,
				title: "Referenced page",
				parentPageId: null,
				position: 1,
			});
			await seedFixtureBody(
				f,
				JSON.parse(
					JSON.stringify([
						{
							id: "task-block",
							type: "task",
							props: { checked: false, assignee: f.userId },
							content: [
								{ type: "text", text: "Collaborative task", styles: {} },
							],
							children: [],
						},
						{
							id: "link-block",
							type: "pageLink",
							props: { pageId: target.id, workspaceId: f.workspaceId },
							children: [],
						},
					]),
				),
			);
			const initial = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
			Y.applyUpdate(doc, initial.state);
			const result = await persistPageBody(f.ctx, {
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				baseRevision: 0,
				generation: 0,
				doc,
			});
			expect(result).toMatchObject({ tasksChanged: true, linksChanged: true });
			expect(
				await f.database.repositories.tasks.listByPage(f.scope, f.page.id),
			).toMatchObject([{ title: "Collaborative task" }]);
			expect(
				await f.database.repositories.pageLinks.listBacklinkSources(
					f.scope,
					target.id,
				),
			).toMatchObject([{ id: f.page.id }]);
			const group = doc.getXmlFragment("body").get(0) as Y.XmlElement;
			group.delete(0, group.length);
			const removed = await persistPageBody(f.ctx, {
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				baseRevision: 1,
				generation: 0,
				doc,
			});
			expect(removed).toMatchObject({ tasksChanged: true, linksChanged: true });
			expect(
				await f.database.repositories.tasks.listByPage(f.scope, f.page.id),
			).toEqual([]);
			expect(
				await f.database.repositories.pageLinks.listBacklinkSources(
					f.scope,
					target.id,
				),
			).toEqual([]);
		} finally {
			doc.destroy();
			await f.database.close();
		}
	});
	test("loads the persisted CRDT identity and enforces tenant scope", async () => {
		const f = await documentFixture();
		try {
			const first = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
			const second = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
			expect(second.state).toEqual(first.state);
			expect(
				await f.database.repositories.documents.find(
					createForeignScope(),
					f.page.id,
				),
			).toBeNull();
		} finally {
			await f.database.close();
		}
	});
	test("commits binary state and search together and reloads the same CRDT history", async () => {
		const f = await documentFixture();
		const doc = new Y.Doc();
		try {
			const initial = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
			Y.applyUpdate(doc, initial.state);
			firstText(doc).insert(0, "Durable collaborative content");
			const result = await persistPageBody(f.ctx, {
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				baseRevision: 0,
				generation: 0,
				doc,
			});
			expect(result.revision).toBe(1);
			const stored = await f.database.repositories.documents.find(
				f.scope,
				f.page.id,
			);
			const reloaded = new Y.Doc();
			Y.applyUpdate(reloaded, stored!.state);
			expect(Y.encodeStateVector(reloaded)).toEqual(Y.encodeStateVector(doc));
			expect(
				(await f.database.repositories.pages.findById(f.scope, f.page.id))
					?.content,
			).toEqual(projectPageBody(doc));
			const [row] = await f.database.db
				.select({ searchText: schema.pages.searchText })
				.from(schema.pages)
				.where(eq(schema.pages.id, f.page.id));
			expect(row?.searchText).toContain("Durable collaborative content");
			firstText(doc).insert(0, "must roll back ");
			await expect(
				f.ctx.ports.uow.transaction((tx) =>
					tx.documents.commit(f.scope, {
						pageId: f.page.id,
						baseRevision: 0,
						generation: 0,
						state: Y.encodeStateAsUpdate(doc),
						contentJson: "[]",
						searchText: "",
					}),
				),
			).rejects.toThrow("ownership changed");
			expect(
				(await f.database.repositories.documents.find(f.scope, f.page.id))
					?.state,
			).toEqual(stored?.state);
			reloaded.destroy();
		} finally {
			doc.destroy();
			await f.database.close();
		}
	});
});

import { createTenantScope } from "@beignet/core/ports";
function createForeignScope() {
	return createTenantScope({ id: "another-workspace" });
}
