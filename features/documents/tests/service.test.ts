import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTenant, createTenantScope } from "@beignet/core/ports";
import {
	createTestContextFactory,
	createTestPorts,
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import {
	createDrizzleSqliteIdempotencyPort,
	createDrizzleSqliteOutboxPort,
	createDrizzleSqliteUnitOfWork,
} from "@beignet/provider-db-drizzle/sqlite";
import * as Y from "yjs";
import type { AppContext } from "@/app-context";
import {
	pageProjectionFromYDoc,
	pageToYDoc,
	replaceCanvasSnapshot,
	replacePageBlocks,
	replacePageDocument,
	replacePageTitle,
	yDocFromUpdate,
} from "@/features/documents/codec";
import { documentCacheEpoch } from "@/features/documents/model";
import type { DocumentStorePort } from "@/features/documents/ports";
import {
	ensureCollaborativeDocument,
	materializeCollaborativeDocument,
	mutateCollaborativeDocument,
	readCollaborativeCanvasProjection,
	readCollaborativePageProjection,
} from "@/features/documents/service";
import {
	pageTaskAttributionOperations,
	setPageTaskAttributionOperations,
} from "@/features/documents/task-attribution-operations";
import { queueDocumentMaterializationUseCase } from "@/features/documents/use-cases";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import type { BlockJson } from "@/features/pages/schemas";
import { appPorts } from "@/infra/app-ports";
import { createRepositories } from "@/infra/db/repositories";
import * as schema from "@/infra/db/schema";
import { createTestDatabase } from "@/infra/db/test-database";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";

function createMemoryDocumentStore(
	options: { applyDelayMs?: number } = {},
): DocumentStorePort {
	const updates = new Map<string, Uint8Array>();
	return {
		provider: "liveblocks",
		async ensureDocument({ documentId }) {
			if (!updates.has(documentId)) {
				const doc = new Y.Doc();
				updates.set(documentId, Y.encodeStateAsUpdate(doc));
				doc.destroy();
			}
		},
		async readBinaryUpdate(documentId) {
			const update = updates.get(documentId);
			return update ? new Uint8Array(update) : null;
		},
		async applyBinaryUpdate(documentId, update) {
			if (options.applyDelayMs) {
				await new Promise((resolve) =>
					setTimeout(resolve, options.applyDelayMs),
				);
			}
			const doc = new Y.Doc();
			const current = updates.get(documentId);
			if (current) Y.applyUpdate(doc, current);
			Y.applyUpdate(doc, update);
			updates.set(documentId, Y.encodeStateAsUpdate(doc));
			doc.destroy();
		},
		async deleteDocument(documentId) {
			updates.delete(documentId);
		},
	};
}

async function createFixture(options: { applyDelayMs?: number } = {}) {
	const database = await createTestDatabase();
	const now = new Date();
	await database.db.insert(schema.user).values({
		id: "document_user",
		name: "Document User",
		email: "document@example.com",
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	await database.db.insert(schema.organization).values({
		id: "document_workspace",
		name: "Documents",
		slug: "documents",
		createdAt: now,
	});
	await database.db.insert(schema.member).values({
		id: "document_member",
		organizationId: "document_workspace",
		userId: "document_user",
		role: "owner",
		createdAt: now,
	});
	const scope = createTenantScope(createTenant("document_workspace"));
	const repositories = database.repositories;
	const uow = createDrizzleSqliteUnitOfWork({
		db: database.db,
		createTransactionPorts: (tx) => ({
			...createRepositories(tx),
			idempotency: createDrizzleSqliteIdempotencyPort(tx),
			outbox: createDrizzleSqliteOutboxPort(tx),
		}),
	});
	return {
		database,
		scope,
		ports: {
			...repositories,
			documentStore: createMemoryDocumentStore(options),
			uow,
		},
	};
}

describe("authoritative collaborative documents", () => {
	it("serializes concurrent first seeds", async () => {
		const fixture = await createFixture({ applyDelayMs: 25 });
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Seed once",
				position: 1,
			});
			const results = await Promise.all([
				ensureCollaborativeDocument({
					scope: fixture.scope,
					kind: "page",
					entityId: page.id,
					ports: fixture.ports,
				}),
				ensureCollaborativeDocument({
					scope: fixture.scope,
					kind: "page",
					entityId: page.id,
					ports: fixture.ports,
				}),
			]);
			expect(results.map((result) => result.seeded).sort()).toEqual([
				false,
				true,
			]);
			const projection = await readCollaborativePageProjection({
				scope: fixture.scope,
				entityId: page.id,
				ports: fixture.ports,
			});
			expect(projection.title).toBe("Seed once");
		} finally {
			await fixture.database.close();
		}
	});

	it("fences destructive provider writes when a seed claim is lost", async () => {
		const fixture = await createFixture();
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Lost claim",
				position: 1,
			});
			let renewalCount = 0;
			let deletes = 0;
			let applies = 0;
			const ports = {
				...fixture.ports,
				documents: {
					...fixture.ports.documents,
					async renewSeed(
						...args: Parameters<typeof fixture.ports.documents.renewSeed>
					) {
						renewalCount += 1;
						return renewalCount === 1
							? fixture.ports.documents.renewSeed(...args)
							: false;
					},
				},
				documentStore: {
					...fixture.ports.documentStore,
					async applyBinaryUpdate(
						...args: Parameters<DocumentStorePort["applyBinaryUpdate"]>
					) {
						applies += 1;
						return fixture.ports.documentStore.applyBinaryUpdate(...args);
					},
					async deleteDocument(
						...args: Parameters<DocumentStorePort["deleteDocument"]>
					) {
						deletes += 1;
						return fixture.ports.documentStore.deleteDocument(...args);
					},
				},
			};

			await expect(
				ensureCollaborativeDocument({
					scope: fixture.scope,
					kind: "page",
					entityId: page.id,
					ports,
				}),
			).rejects.toThrow("Lost the seed claim");
			expect(deletes).toBe(0);
			expect(applies).toBe(0);
		} finally {
			await fixture.database.close();
		}
	});

	it("seeds once and materializes server page mutations into SQLite", async () => {
		const fixture = await createFixture();
		try {
			const initialContent: BlockJson[] = [
				{
					id: "paragraph-1",
					type: "paragraph",
					props: {
						textColor: "default",
						backgroundColor: "default",
						textAlignment: "left",
					},
					content: [{ type: "text", text: "Before", styles: {} }],
					children: [],
				},
			];
			const created = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Original",
				position: 1,
			});
			await fixture.ports.pages.saveContent(
				fixture.scope,
				created.id,
				JSON.stringify(initialContent),
				extractPageSearchText(initialContent),
			);

			const first = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: created.id,
				ports: fixture.ports,
			});
			expect(first.seeded).toBe(true);

			const nextContent: BlockJson[] = [
				{
					...initialContent[0],
					content: [{ type: "text", text: "After", styles: {} }],
				} as BlockJson,
			];
			const projected = await mutateCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: created.id,
				ports: fixture.ports,
				apply(doc) {
					replacePageTitle(doc, "Renamed");
					replacePageBlocks(doc, nextContent);
				},
			});
			expect(projected.kind).toBe("page");
			if (projected.kind !== "page")
				throw new Error("Expected page projection");
			expect(projected.titleChanged).toBe(true);
			const page = await fixture.ports.pages.findById(
				fixture.scope,
				created.id,
			);
			expect(page?.title).toBe("Renamed");
			expect(page?.content).toEqual(nextContent);

			const second = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: created.id,
				ports: fixture.ports,
			});
			expect(second.seeded).toBe(false);
		} finally {
			await fixture.database.close();
		}
	});

	it("attributes each task assignment to the mutation that authored it", async () => {
		const fixture = await createFixture();
		try {
			const now = new Date();
			await fixture.database.db.insert(schema.user).values({
				id: "assigned_user",
				name: "Assigned User",
				email: "assigned@example.com",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			});
			await fixture.database.db.insert(schema.member).values({
				id: "assigned_member",
				organizationId: "document_workspace",
				userId: "assigned_user",
				role: "member",
				createdAt: now,
			});
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Attributed tasks",
				position: 1,
			});
			const taskContent: BlockJson[] = [
				{
					id: "assigned-task",
					type: "task",
					props: {
						checked: false,
						due: "",
						dueTime: "",
						reminder: "",
						assignee: "assigned_user",
					},
					content: [{ type: "text", text: "Review this", styles: {} }],
					children: [],
				},
			];

			const result = await mutateCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
				assignmentActor: {
					userId: "document_user",
					name: "Document User",
				},
				defaultTaskAssigneeId: "document_user",
				apply(doc) {
					replacePageBlocks(doc, taskContent);
				},
			});

			expect(result.kind).toBe("page");
			if (result.kind !== "page") throw new Error("Expected page projection");
			expect(result.assignmentNotifications).toHaveLength(1);
			expect(result.assignmentNotifications[0]?.payload).toMatchObject({
				assignedByUserId: "document_user",
				assignedByName: "Document User",
			});

			await mutateCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
				assignmentActor: {
					userId: "document_user",
					name: "Document User",
				},
				apply(doc) {
					replacePageBlocks(doc, [
						{
							...taskContent[0],
							props: { ...taskContent[0]?.props, assignee: "" },
						} as BlockJson,
					]);
				},
			});
			const clearedUpdate = await fixture.ports.documentStore.readBinaryUpdate(
				`doc:v2:page:${page.id}`,
			);
			const clearedDoc = yDocFromUpdate(clearedUpdate as Uint8Array);
			try {
				expect(pageTaskAttributionOperations(clearedDoc)).toEqual(new Map());
			} finally {
				clearedDoc.destroy();
			}
		} finally {
			await fixture.database.close();
		}
	});

	it("persists server task attribution before sending the Yjs update", async () => {
		const fixture = await createFixture();
		try {
			const now = new Date();
			await fixture.database.db.insert(schema.user).values({
				id: "durable_assignee",
				name: "Durable Assignee",
				email: "durable@example.com",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			});
			await fixture.database.db.insert(schema.member).values({
				id: "durable_assignee_member",
				organizationId: "document_workspace",
				userId: "durable_assignee",
				role: "member",
				createdAt: now,
			});
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Durable attribution",
				position: 1,
			});
			await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
			});

			let attributionExistedBeforeProviderWrite = false;
			const ports = {
				...fixture.ports,
				documentStore: {
					...fixture.ports.documentStore,
					async applyBinaryUpdate(
						...args: Parameters<DocumentStorePort["applyBinaryUpdate"]>
					) {
						const pending = await fixture.ports.documents.listTaskAttributions(
							fixture.scope,
							`doc:v2:page:${page.id}`,
						);
						attributionExistedBeforeProviderWrite = pending.some(
							(attribution) =>
								attribution.blockId === "durable-task" &&
								attribution.assignee === "durable_assignee",
						);
						return fixture.ports.documentStore.applyBinaryUpdate(...args);
					},
				},
			};

			await mutateCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports,
				assignmentActor: {
					userId: "document_user",
					name: "Document User",
				},
				apply(doc) {
					replacePageBlocks(doc, [
						{
							id: "durable-task",
							type: "task",
							props: {
								checked: false,
								due: "",
								dueTime: "",
								reminder: "",
								assignee: "durable_assignee",
							},
							content: [{ type: "text", text: "Persist first", styles: {} }],
							children: [],
						},
					]);
				},
			});

			expect(attributionExistedBeforeProviderWrite).toBe(true);
		} finally {
			await fixture.database.close();
		}
	});

	it("consumes only the task attribution matching the projected assignee", async () => {
		const fixture = await createFixture();
		try {
			const firstOperationId = "00000000-0000-4000-8000-000000000001";
			const nextOperationId = "00000000-0000-4000-8000-000000000002";
			const now = new Date();
			await fixture.database.db.insert(schema.user).values({
				id: "next_assignee",
				name: "Next Assignee",
				email: "next-assignee@example.com",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			});
			await fixture.database.db.insert(schema.member).values({
				id: "next_assignee_member",
				organizationId: "document_workspace",
				userId: "next_assignee",
				role: "member",
				createdAt: now,
			});
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Sequential attribution",
				position: 1,
			});
			const seeded = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
			});
			await fixture.ports.documents.recordTaskAttributions(
				fixture.scope,
				seeded.documentId,
				[
					{
						blockId: "sequential-task",
						assignee: "document_user",
						operationId: firstOperationId,
						actorUserId: "document_user",
						actorName: "Document User",
					},
					{
						blockId: "sequential-task",
						assignee: "next_assignee",
						operationId: nextOperationId,
						actorUserId: "document_user",
						actorName: "Document User",
					},
				],
			);

			const replaceAssignee = async (assignee: string, operationId: string) => {
				const update = await fixture.ports.documentStore.readBinaryUpdate(
					seeded.documentId,
				);
				const doc = yDocFromUpdate(update as Uint8Array);
				try {
					const before = Y.encodeStateVector(doc);
					replacePageBlocks(doc, [
						{
							id: "sequential-task",
							type: "task",
							props: {
								checked: false,
								due: "",
								dueTime: "",
								reminder: "",
								assignee,
							},
							content: [{ type: "text", text: "Sequential", styles: {} }],
							children: [],
						},
					]);
					setPageTaskAttributionOperations(doc, [
						{ blockId: "sequential-task", operationId },
					]);
					await fixture.ports.documentStore.applyBinaryUpdate(
						seeded.documentId,
						Y.encodeStateAsUpdate(doc, before),
					);
				} finally {
					doc.destroy();
				}
			};

			await replaceAssignee("document_user", firstOperationId);
			await materializeCollaborativeDocument({
				scope: fixture.scope,
				documentId: seeded.documentId,
				ports: fixture.ports,
			});
			expect(
				await fixture.ports.documents.listTaskAttributions(
					fixture.scope,
					seeded.documentId,
				),
			).toEqual([
				expect.objectContaining({
					blockId: "sequential-task",
					assignee: "next_assignee",
				}),
			]);

			await replaceAssignee(
				"next_assignee",
				"00000000-0000-4000-8000-000000000099",
			);
			await materializeCollaborativeDocument({
				scope: fixture.scope,
				documentId: seeded.documentId,
				ports: fixture.ports,
			});
			expect(
				(await fixture.ports.tasks.listByPage(fixture.scope, page.id))[0]
					?.assigneeId,
			).toBe("document_user");
			expect(
				await fixture.ports.documents.listTaskAttributions(
					fixture.scope,
					seeded.documentId,
				),
			).toHaveLength(1);

			await replaceAssignee("next_assignee", nextOperationId);
			await materializeCollaborativeDocument({
				scope: fixture.scope,
				documentId: seeded.documentId,
				ports: fixture.ports,
			});
			expect(
				(await fixture.ports.tasks.listByPage(fixture.scope, page.id))[0]
					?.assigneeId,
			).toBe("next_assignee");
			expect(
				await fixture.ports.documents.listTaskAttributions(
					fixture.scope,
					seeded.documentId,
				),
			).toEqual([]);
		} finally {
			await fixture.database.close();
		}
	});

	it("projects browser content safely before exact task attribution arrives", async () => {
		const fixture = await createFixture();
		try {
			const browserOperationId = "00000000-0000-4000-8000-000000000003";
			const now = new Date();
			await fixture.database.db.insert(schema.user).values({
				id: "browser_assignee",
				name: "Browser Assignee",
				email: "browser-assignee@example.com",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			});
			await fixture.database.db.insert(schema.member).values({
				id: "browser_assignee_member",
				organizationId: "document_workspace",
				userId: "browser_assignee",
				role: "member",
				createdAt: now,
			});
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Browser attribution",
				position: 1,
			});
			const taskContent: BlockJson[] = [
				{
					id: "browser-task",
					type: "task",
					props: {
						checked: false,
						due: "",
						dueTime: "",
						reminder: "",
						assignee: "browser_assignee",
					},
					content: [{ type: "text", text: "Browser task", styles: {} }],
					children: [],
				},
			];
			const seeded = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
			});
			await fixture.ports.documents.recordTaskAttributions(
				fixture.scope,
				seeded.documentId,
				[
					{
						blockId: "browser-task",
						assignee: "browser_assignee",
						operationId: browserOperationId,
						actorUserId: "document_user",
						actorName: "Document User",
					},
				],
			);

			const beforeProviderSync = await materializeCollaborativeDocument({
				scope: fixture.scope,
				documentId: seeded.documentId,
				ports: fixture.ports,
			});
			expect(beforeProviderSync.kind).toBe("page");
			if (beforeProviderSync.kind !== "page") {
				throw new Error("Expected page projection");
			}
			expect(beforeProviderSync.assignmentNotifications).toEqual([]);
			expect(
				await fixture.ports.documents.listTaskAttributions(
					fixture.scope,
					seeded.documentId,
				),
			).toHaveLength(1);

			const contentUpdate = await fixture.ports.documentStore.readBinaryUpdate(
				seeded.documentId,
			);
			const contentDoc = yDocFromUpdate(contentUpdate as Uint8Array);
			try {
				const before = Y.encodeStateVector(contentDoc);
				replacePageBlocks(contentDoc, taskContent);
				setPageTaskAttributionOperations(contentDoc, [
					{ blockId: "browser-task", operationId: browserOperationId },
				]);
				await fixture.ports.documentStore.applyBinaryUpdate(
					seeded.documentId,
					Y.encodeStateAsUpdate(contentDoc, before),
				);
			} finally {
				contentDoc.destroy();
			}

			const result = await materializeCollaborativeDocument({
				scope: fixture.scope,
				documentId: seeded.documentId,
				ports: fixture.ports,
			});
			expect(result.kind).toBe("page");
			if (result.kind !== "page") {
				throw new Error("Expected page projection");
			}
			expect(result.assignmentNotifications[0]?.payload).toMatchObject({
				assignedByUserId: "document_user",
				assignedByName: "Document User",
			});
			expect(
				(await fixture.ports.pages.findById(fixture.scope, page.id))?.content,
			).toEqual(taskContent);
			expect(
				(await fixture.ports.tasks.listByPage(fixture.scope, page.id))[0]
					?.assigneeId,
			).toBe("browser_assignee");
			expect(
				await fixture.ports.documents.listTaskAttributions(
					fixture.scope,
					seeded.documentId,
				),
			).toEqual([]);
		} finally {
			await fixture.database.close();
		}
	});

	it("persists browser task attribution before acknowledging the queue request", async () => {
		const fixture = await createFixture();
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Queued attribution",
				position: 1,
			});
			const testPorts = createTestPorts<
				AppContext["ports"],
				AppTransactionPorts
			>({
				base: appPorts,
				overrides: {
					...fixture.ports,
					gate: appPorts.gate,
					devtools: createInMemoryDevtools(),
				},
			});
			const createContext = createTestContextFactory<
				AppContext,
				AppContext["ports"]
			>({
				ports: testPorts.ports,
				actor: createTestUserActor("document_user", {
					displayName: "Document User",
				}),
				auth: {
					user: {
						id: "document_user",
						email: "document@example.com",
						name: "Document User",
						accessStatus: ACCESS_STATUS_APPROVED,
					},
					session: {
						id: "document_session",
						activeOrganizationId: "document_workspace",
					},
				},
				tenant: createTestTenant("document_workspace"),
				extra: { membership: { role: "owner" } },
			});
			const tester = createUseCaseTester<AppContext>(createContext);
			const ctx = await tester.ctx();
			await tester.run(
				queueDocumentMaterializationUseCase,
				{
					kind: "page",
					id: page.id,
					taskAttributions: [
						{
							blockId: "queued-task",
							assignee: "document_user",
							operationId: "00000000-0000-4000-8000-000000000004",
						},
					],
				},
				{ ctx },
			);

			const registered = await fixture.ports.documents.findByEntity(
				fixture.scope,
				"page",
				page.id,
			);
			expect(registered).not.toBeNull();
			expect(
				await fixture.ports.documents.listTaskAttributions(
					fixture.scope,
					registered?.documentId ?? "",
				),
			).toEqual([
				expect.objectContaining({
					blockId: "queued-task",
					assignee: "document_user",
					actorUserId: "document_user",
					actorName: "Document User",
				}),
			]);
		} finally {
			await fixture.database.close();
		}
	});

	it("applies concurrent users' task attributions independently", async () => {
		const fixture = await createFixture();
		try {
			const now = new Date();
			await fixture.database.db.insert(schema.user).values([
				{
					id: "assignee_alice",
					name: "Alice",
					email: "alice@example.com",
					emailVerified: true,
					createdAt: now,
					updatedAt: now,
				},
				{
					id: "assignee_bob",
					name: "Bob",
					email: "bob@example.com",
					emailVerified: true,
					createdAt: now,
					updatedAt: now,
				},
			]);
			await fixture.database.db.insert(schema.member).values([
				{
					id: "member_alice",
					organizationId: "document_workspace",
					userId: "assignee_alice",
					role: "member",
					createdAt: now,
				},
				{
					id: "member_bob",
					organizationId: "document_workspace",
					userId: "assignee_bob",
					role: "member",
					createdAt: now,
				},
			]);
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Concurrent assignments",
				position: 1,
			});
			const content: BlockJson[] = [
				{
					id: "task-alice",
					type: "task",
					props: {
						checked: false,
						due: "",
						dueTime: "",
						reminder: "",
						assignee: "assignee_alice",
					},
					content: [{ type: "text", text: "Alice task", styles: {} }],
					children: [],
				},
				{
					id: "task-bob",
					type: "task",
					props: {
						checked: false,
						due: "",
						dueTime: "",
						reminder: "",
						assignee: "assignee_bob",
					},
					content: [{ type: "text", text: "Bob task", styles: {} }],
					children: [],
				},
			];
			const seeded = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
			});
			const update = await fixture.ports.documentStore.readBinaryUpdate(
				seeded.documentId,
			);
			const doc = yDocFromUpdate(update as Uint8Array);
			try {
				const before = Y.encodeStateVector(doc);
				replacePageBlocks(doc, content);
				setPageTaskAttributionOperations(doc, [
					{
						blockId: "task-alice",
						operationId: "00000000-0000-4000-8000-000000000005",
					},
					{
						blockId: "task-bob",
						operationId: "00000000-0000-4000-8000-000000000006",
					},
				]);
				await fixture.ports.documentStore.applyBinaryUpdate(
					seeded.documentId,
					Y.encodeStateAsUpdate(doc, before),
				);
			} finally {
				doc.destroy();
			}

			await materializeCollaborativeDocument({
				scope: fixture.scope,
				documentId: seeded.documentId,
				ports: fixture.ports,
			});
			await materializeCollaborativeDocument({
				scope: fixture.scope,
				documentId: seeded.documentId,
				ports: fixture.ports,
				taskAttributions: [
					{
						blockId: "task-alice",
						assignee: "assignee_alice",
						operationId: "00000000-0000-4000-8000-000000000005",
						actor: { userId: "assignee_alice", name: "Alice" },
					},
				],
			});
			let tasks = await fixture.ports.tasks.listByPage(fixture.scope, page.id);
			expect(
				Object.fromEntries(
					tasks.map((task) => [task.sourceBlockId, task.assigneeId]),
				),
			).toEqual({ "task-alice": "assignee_alice", "task-bob": null });

			await materializeCollaborativeDocument({
				scope: fixture.scope,
				documentId: seeded.documentId,
				ports: fixture.ports,
				taskAttributions: [
					{
						blockId: "task-bob",
						assignee: "assignee_bob",
						operationId: "00000000-0000-4000-8000-000000000006",
						actor: { userId: "assignee_bob", name: "Bob" },
					},
				],
			});
			tasks = await fixture.ports.tasks.listByPage(fixture.scope, page.id);
			expect(
				Object.fromEntries(
					tasks.map((task) => [task.sourceBlockId, task.assigneeId]),
				),
			).toEqual({
				"task-alice": "assignee_alice",
				"task-bob": "assignee_bob",
			});
		} finally {
			await fixture.database.close();
		}
	});

	it("reads authoritative page content before its SQLite projection catches up", async () => {
		const fixture = await createFixture();
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Projected title",
				position: 1,
			});
			const seeded = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
			});
			const update = await fixture.ports.documentStore.readBinaryUpdate(
				seeded.documentId,
			);
			const browserDoc = yDocFromUpdate(update as Uint8Array);
			try {
				const before = Y.encodeStateVector(browserDoc);
				replacePageTitle(browserDoc, "Live title");
				await fixture.ports.documentStore.applyBinaryUpdate(
					seeded.documentId,
					Y.encodeStateAsUpdate(browserDoc, before),
				);
			} finally {
				browserDoc.destroy();
			}

			expect(
				(await fixture.ports.pages.findById(fixture.scope, page.id))?.title,
			).toBe("Projected title");
			expect(
				(
					await readCollaborativePageProjection({
						scope: fixture.scope,
						entityId: page.id,
						ports: fixture.ports,
					})
				).title,
			).toBe("Live title");
		} finally {
			await fixture.database.close();
		}
	});

	it("captures the authoritative state before a destructive replacement", async () => {
		const fixture = await createFixture();
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Original projection",
				position: 1,
			});
			const seeded = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
			});
			const update = await fixture.ports.documentStore.readBinaryUpdate(
				seeded.documentId,
			);
			const browserDoc = yDocFromUpdate(update as Uint8Array);
			try {
				const before = Y.encodeStateVector(browserDoc);
				replacePageTitle(browserDoc, "Unprojected live title");
				await fixture.ports.documentStore.applyBinaryUpdate(
					seeded.documentId,
					Y.encodeStateAsUpdate(browserDoc, before),
				);
			} finally {
				browserDoc.destroy();
			}

			const captured: {
				previousTitle: string | null;
				checkpointTitle: string | null;
			} = { previousTitle: null, checkpointTitle: null };
			await mutateCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
				apply(doc) {
					captured.previousTitle = pageProjectionFromYDoc(doc).title;
					replacePageTitle(doc, "Restored title");
				},
				beforeWrite() {
					captured.checkpointTitle = captured.previousTitle;
				},
			});

			expect(captured.checkpointTitle).toBe("Unprojected live title");
			expect(
				(await fixture.ports.pages.findById(fixture.scope, page.id))?.title,
			).toBe("Restored title");
		} finally {
			await fixture.database.close();
		}
	});

	it("keeps concurrent writes to the old generation out of a restored page", () => {
		const originalContent: BlockJson[] = [
			{
				id: "original",
				type: "paragraph",
				props: {},
				content: [{ type: "text", text: "Original", styles: {} }],
				children: [],
			},
		];
		const restoredContent: BlockJson[] = [
			{
				id: "restored",
				type: "paragraph",
				props: {},
				content: [{ type: "text", text: "Restored", styles: {} }],
				children: [],
			},
		];
		const concurrentContent: BlockJson[] = [
			{
				id: "concurrent",
				type: "paragraph",
				props: {},
				content: [{ type: "text", text: "Concurrent", styles: {} }],
				children: [],
			},
		];
		const seeded = pageToYDoc({
			title: "Original",
			content: originalContent,
			contentUpdatedAt: new Date().toISOString(),
		});
		const seedUpdate = Y.encodeStateAsUpdate(seeded);
		const seedVector = Y.encodeStateVector(seeded);
		const restoreWorker = yDocFromUpdate(seedUpdate);
		const collaborator = yDocFromUpdate(seedUpdate);
		const merged = yDocFromUpdate(seedUpdate);
		try {
			replacePageDocument(
				restoreWorker,
				{ title: "Restored", content: restoredContent },
				"restore-generation",
			);
			replacePageBlocks(collaborator, concurrentContent);

			Y.applyUpdate(merged, Y.encodeStateAsUpdate(restoreWorker, seedVector));
			Y.applyUpdate(merged, Y.encodeStateAsUpdate(collaborator, seedVector));

			const projection = pageProjectionFromYDoc(merged);
			expect(projection.title).toBe("Restored");
			expect(projection.content.map((block) => block.id)).toEqual(["restored"]);
			expect(projection.content[0]?.content).toEqual(
				restoredContent[0]?.content,
			);
		} finally {
			seeded.destroy();
			restoreWorker.destroy();
			collaborator.destroy();
			merged.destroy();
		}
	});

	it("retires inactive page-generation payloads after replacement", () => {
		const content = (id: string): BlockJson[] => [
			{
				id,
				type: "paragraph",
				props: {},
				content: [{ type: "text", text: id, styles: {} }],
				children: [],
			},
		];
		const doc = pageToYDoc({
			title: "Legacy",
			content: content("legacy"),
			contentUpdatedAt: new Date().toISOString(),
		});
		try {
			replacePageDocument(
				doc,
				{ title: "First", content: content("first") },
				"first-generation",
			);
			expect(doc.getXmlFragment("blocknote").length).toBe(0);
			expect(doc.getText("title").length).toBe(0);

			replacePageDocument(
				doc,
				{ title: "Second", content: content("second") },
				"second-generation",
			);
			expect(doc.getXmlFragment("blocknote:first-generation").length).toBe(0);
			expect(doc.getText("title:first-generation").length).toBe(0);
			expect(pageProjectionFromYDoc(doc)).toEqual({
				title: "Second",
				content: expect.arrayContaining([
					expect.objectContaining({ id: "second" }),
				]),
			});
		} finally {
			doc.destroy();
		}
	});

	it("materializes authoritative tldraw records into the canvas projection", async () => {
		const fixture = await createFixture();
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Canvas",
				position: 1,
			});
			const canvas = await fixture.ports.canvases.create(fixture.scope, {
				userId: "document_user",
				pageId: page.id,
			});
			const snapshot = {
				schema: { schemaVersion: 2 },
				store: { "shape:one": { id: "shape:one", typeName: "shape" } },
			};
			await mutateCollaborativeDocument({
				scope: fixture.scope,
				kind: "canvas",
				entityId: canvas.id,
				ports: fixture.ports,
				apply(doc) {
					replaceCanvasSnapshot(doc, snapshot);
				},
			});
			expect(
				(await fixture.ports.canvases.findById(fixture.scope, canvas.id))
					?.snapshot,
			).toEqual(snapshot);
		} finally {
			await fixture.database.close();
		}
	});

	it("reads an authoritative canvas before its SQLite projection catches up", async () => {
		const fixture = await createFixture();
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Canvas",
				position: 1,
			});
			const canvas = await fixture.ports.canvases.create(fixture.scope, {
				userId: "document_user",
				pageId: page.id,
			});
			const seeded = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "canvas",
				entityId: canvas.id,
				ports: fixture.ports,
			});
			const snapshot = {
				schema: { schemaVersion: 2 },
				store: { "shape:live": { id: "shape:live", typeName: "shape" } },
			};
			const update = await fixture.ports.documentStore.readBinaryUpdate(
				seeded.documentId,
			);
			const doc = yDocFromUpdate(update as Uint8Array);
			try {
				const before = Y.encodeStateVector(doc);
				replaceCanvasSnapshot(doc, snapshot);
				await fixture.ports.documentStore.applyBinaryUpdate(
					seeded.documentId,
					Y.encodeStateAsUpdate(doc, before),
				);
			} finally {
				doc.destroy();
			}

			expect(
				(await fixture.ports.canvases.findById(fixture.scope, canvas.id))
					?.snapshot,
			).not.toEqual(snapshot);
			expect(
				await readCollaborativeCanvasProjection({
					scope: fixture.scope,
					entityId: canvas.id,
					ports: fixture.ports,
				}),
			).toEqual(snapshot);
		} finally {
			await fixture.database.close();
		}
	});

	it("repairs a missing ready room from the latest SQLite projection", async () => {
		const fixture = await createFixture();
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Recover me",
				position: 1,
			});
			const seeded = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
			});
			const beforeRepair = await fixture.ports.documents.findByDocumentId(
				fixture.scope,
				seeded.documentId,
			);
			if (!beforeRepair) throw new Error("Seeded document was not registered");
			const initialCacheEpoch = documentCacheEpoch(beforeRepair);
			// The cache epoch is time-based but must change for every provider repair.
			await new Promise((resolve) => setTimeout(resolve, 2));
			await fixture.ports.documentStore.deleteDocument(seeded.documentId);

			const repaired = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
				verifyReady: true,
			});
			expect(repaired.seeded).toBe(true);
			const afterRepair = await fixture.ports.documents.findByDocumentId(
				fixture.scope,
				repaired.documentId,
			);
			if (!afterRepair) throw new Error("Repaired document was not registered");
			expect(documentCacheEpoch(afterRepair)).not.toBe(initialCacheEpoch);
			const update = await fixture.ports.documentStore.readBinaryUpdate(
				repaired.documentId,
			);
			expect(update).not.toBeNull();
			const doc = yDocFromUpdate(update as Uint8Array);
			try {
				expect(pageProjectionFromYDoc(doc).title).toBe("Recover me");
			} finally {
				doc.destroy();
			}
		} finally {
			await fixture.database.close();
		}
	});

	it("refreshes a ready room from the latest SQLite projection before cutover", async () => {
		const fixture = await createFixture();
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Seeded before edits",
				position: 1,
			});
			const seeded = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
			});
			expect(seeded.seeded).toBe(true);
			await fixture.ports.pages.update(fixture.scope, page.id, {
				title: "Latest SQLite edit",
			});

			expect(
				(
					await readCollaborativePageProjection({
						scope: fixture.scope,
						entityId: page.id,
						ports: fixture.ports,
					})
				).title,
			).toBe("Seeded before edits");

			const refreshed = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
				refreshFromProjection: true,
			});
			expect(refreshed).toMatchObject({ seeded: false, refreshed: true });
			expect(
				(
					await readCollaborativePageProjection({
						scope: fixture.scope,
						entityId: page.id,
						ports: fixture.ports,
					})
				).title,
			).toBe("Latest SQLite edit");
		} finally {
			await fixture.database.close();
		}
	});

	it("repairs a missing ready room before projection", async () => {
		const fixture = await createFixture();
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Projection recovery",
				position: 1,
			});
			const seeded = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
			});
			await fixture.ports.documentStore.deleteDocument(seeded.documentId);

			const result = await materializeCollaborativeDocument({
				scope: fixture.scope,
				documentId: seeded.documentId,
				ports: fixture.ports,
			});
			expect(result.kind).toBe("page");
			expect(
				await fixture.ports.documentStore.readBinaryUpdate(seeded.documentId),
			).not.toBeNull();
		} finally {
			await fixture.database.close();
		}
	});

	it("repairs a missing provider room before a server mutation", async () => {
		const fixture = await createFixture();
		try {
			const page = await fixture.ports.pages.create(fixture.scope, {
				userId: "document_user",
				parentPageId: null,
				title: "Before provider loss",
				position: 1,
			});
			const seeded = await ensureCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
			});
			await fixture.ports.documentStore.deleteDocument(seeded.documentId);

			await mutateCollaborativeDocument({
				scope: fixture.scope,
				kind: "page",
				entityId: page.id,
				ports: fixture.ports,
				apply(doc) {
					replacePageTitle(doc, "After provider recovery");
				},
			});

			expect(
				(await fixture.ports.pages.findById(fixture.scope, page.id))?.title,
			).toBe("After provider recovery");
		} finally {
			await fixture.database.close();
		}
	});
});
