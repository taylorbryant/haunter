import { describe, expect, it } from "bun:test";
import { createTenant, createTenantScope } from "@beignet/core/ports";
import { eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { createTestDatabase } from "@/infra/db/test-database";

describe("tenant-scoped repositories", () => {
	it("cannot read or mutate known foreign resource ids", async () => {
		const testDatabase = await createTestDatabase();
		try {
			const now = new Date();
			await testDatabase.db.insert(schema.user).values({
				id: "user_scope_test",
				name: "Scope Test",
				email: "scope@example.com",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			});
			await testDatabase.db.insert(schema.organization).values([
				{
					id: "workspace_a",
					name: "Workspace A",
					slug: "workspace-a",
					createdAt: now,
				},
				{
					id: "workspace_b",
					name: "Workspace B",
					slug: "workspace-b",
					createdAt: now,
				},
			]);
			await testDatabase.db.insert(schema.member).values([
				{
					id: "member_scope_a",
					organizationId: "workspace_a",
					userId: "user_scope_test",
					role: "owner",
					createdAt: now,
				},
				{
					id: "member_scope_b",
					organizationId: "workspace_b",
					userId: "user_scope_test",
					role: "owner",
					createdAt: now,
				},
			]);

			const scopeA = createTenantScope(createTenant("workspace_a"));
			const scopeB = createTenantScope(createTenant("workspace_b"));
			const repositories = testDatabase.repositories;
			const pageA = await repositories.pages.create(scopeA, {
				userId: "user_scope_test",
				parentPageId: null,
				title: "Workspace A page",
				position: 1,
			});
			const pageB = await repositories.pages.create(scopeB, {
				userId: "user_scope_test",
				parentPageId: null,
				title: "Workspace B page",
				position: 1,
			});
			const task = await repositories.tasks.create(scopeA, {
				userId: "user_scope_test",
				pageId: pageA.id,
				sourceBlockId: null,
				title: "Scoped task",
				completed: false,
				dueDate: null,
				dueTime: null,
				assigneeId: null,
				completedAt: null,
			});
			const inboxItem = await repositories.inboxItems.create(scopeA, {
				userId: "user_scope_test",
				kind: "page",
				pageId: pageA.id,
				taskId: null,
			});
			const canvas = await repositories.canvases.create(scopeA, {
				userId: "user_scope_test",
				pageId: pageA.id,
			});
			const share = await repositories.shares.create(scopeA, {
				pageId: pageA.id,
				token: "scope-test-token",
				createdBy: "user_scope_test",
			});
			const version = await repositories.pageVersions.create(scopeA, {
				pageId: pageA.id,
				title: pageA.title,
				icon: null,
				contentJson: "[]",
				cause: "checkpoint",
				createdBy: "user_scope_test",
			});

			expect(pageA.workspaceId).toBe("workspace_a");
			expect(await repositories.pages.findById(scopeB, pageA.id)).toBeNull();
			expect(await repositories.tasks.findById(scopeB, task.id)).toBeNull();
			expect(
				await repositories.inboxItems.findForUser(
					scopeB,
					"user_scope_test",
					inboxItem.id,
				),
			).toBeNull();
			expect(
				await repositories.inboxItems.listForUser(scopeB, "user_scope_test", {
					limit: 20,
				}),
			).toEqual({ items: [], nextCursor: null });
			expect(
				await repositories.canvases.findById(scopeB, canvas.id),
			).toBeNull();
			expect(await repositories.shares.findByPage(scopeB, pageA.id)).toBeNull();
			expect(
				await repositories.pageVersions.findById(scopeB, version.id),
			).toBeNull();
			await repositories.pageNavigation.setFavorite(
				scopeA,
				"user_scope_test",
				pageA.id,
				true,
			);
			expect(
				(
					await repositories.pageNavigation.listForUser(
						scopeA,
						"user_scope_test",
						10,
					)
				).favorites.map((page) => page.id),
			).toEqual([pageA.id]);
			expect(
				(
					await repositories.pageNavigation.listForUser(
						scopeB,
						"user_scope_test",
						10,
					)
				).favorites,
			).toEqual([]);
			await expect(
				repositories.pageNavigation.recordView(
					scopeB,
					"user_scope_test",
					pageA.id,
				),
			).rejects.toThrow("outside the tenant scope");

			await expect(
				repositories.pages.create(scopeA, {
					userId: "user_scope_test",
					parentPageId: pageB.id,
					title: "Foreign child",
					position: 2,
				}),
			).rejects.toThrow("outside the tenant scope");
			await expect(
				repositories.pages.update(scopeA, pageA.id, {
					parentPageId: pageB.id,
				}),
			).rejects.toThrow("outside the tenant scope");
			await expect(
				repositories.tasks.create(scopeA, {
					userId: "user_scope_test",
					pageId: pageB.id,
					sourceBlockId: null,
					title: "Foreign page task",
					completed: false,
					dueDate: null,
					dueTime: null,
					assigneeId: null,
					completedAt: null,
				}),
			).rejects.toThrow("outside the tenant scope");
			await expect(
				repositories.inboxItems.create(scopeA, {
					userId: "user_scope_test",
					kind: "page",
					pageId: pageB.id,
					taskId: null,
				}),
			).rejects.toThrow("outside the tenant scope");
			await expect(
				repositories.canvases.create(scopeA, {
					userId: "user_scope_test",
					pageId: pageB.id,
				}),
			).rejects.toThrow("outside the tenant scope");
			await expect(
				repositories.shares.create(scopeA, {
					pageId: pageB.id,
					token: "foreign-scope-token",
					createdBy: "user_scope_test",
				}),
			).rejects.toThrow("outside the tenant scope");
			await expect(
				repositories.pageVersions.create(scopeA, {
					pageId: pageB.id,
					title: pageB.title,
					icon: null,
					contentJson: "[]",
					cause: "checkpoint",
					createdBy: "user_scope_test",
				}),
			).rejects.toThrow("outside the tenant scope");

			await expect(
				repositories.pages.update(scopeB, pageA.id, { title: "Hijacked" }),
			).rejects.toThrow();
			await repositories.tasks.delete(scopeB, task.id);
			await repositories.inboxItems.deleteForUser(
				scopeB,
				"user_scope_test",
				inboxItem.id,
			);
			await repositories.canvases.deleteByPageIds(scopeB, [pageA.id]);
			await repositories.shares.deleteByPage(scopeB, pageA.id);
			await repositories.pages.setDeletedByIds(
				scopeB,
				[pageA.id],
				now.toISOString(),
			);

			expect((await repositories.pages.findById(scopeA, pageA.id))?.title).toBe(
				"Workspace A page",
			);
			expect(await repositories.tasks.findById(scopeA, task.id)).not.toBeNull();
			expect(
				await repositories.inboxItems.findForUser(
					scopeA,
					"user_scope_test",
					inboxItem.id,
				),
			).not.toBeNull();
			expect(
				await repositories.canvases.findById(scopeA, canvas.id),
			).not.toBeNull();
			expect(
				await repositories.shares.findByPage(scopeA, pageA.id),
			).not.toBeNull();
			expect(
				(await repositories.pages.findMetaById(scopeA, pageA.id))?.deletedAt,
			).toBeNull();

			await expect(
				repositories.pageLinks.replaceForSource(
					scopeA,
					pageA.id,
					"user_scope_test",
					[pageB.id],
				),
			).rejects.toThrow("cannot cross tenant boundaries");

			// Token lookup is the capability bootstrap; its persisted workspace id
			// is used to construct the scope for subsequent page and canvas reads.
			expect((await repositories.shares.findByToken(share.token))?.id).toBe(
				share.id,
			);

			await repositories.pageNavigation.recordView(
				scopeA,
				"user_scope_test",
				pageA.id,
			);
			await testDatabase.db
				.delete(schema.member)
				.where(eq(schema.member.id, "member_scope_a"));
			expect(
				await repositories.pageNavigation.listForUser(
					scopeA,
					"user_scope_test",
					10,
				),
			).toEqual({ favorites: [], recents: [] });
		} finally {
			await testDatabase.close();
		}
	});
});
