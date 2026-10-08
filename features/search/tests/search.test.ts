import { afterEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { createTenantScope } from "@beignet/core/ports";
import {
	createTestContextFactory,
	createTestPorts,
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/testing";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/app-context";
import {
	createTestDatabase,
	type TestDatabase,
} from "@/infra/db/test-database";
import * as schema from "@/infra/db/schema";
import { appPorts } from "@/infra/port-wiring";
import type { AppTransactionPorts } from "@/ports";
import { searchWorkspaceUseCase } from "../use-cases";
import { SearchWorkspaceInputSchema } from "../schemas";
import { searchWorkspaceCapability } from "../agent-capabilities";
import { parseWorkspacePath } from "@/features/agents/mcp-app/workspace-bridge";
import { agentCapabilityRegistry } from "@/lib/agent-capability-registry";
import { AGENT_PERMISSION_PROFILES } from "@/features/agents/permission-profiles";
import { agentCapabilityMetadata } from "@/lib/agent-auth-adapter";

const databases: TestDatabase[] = [];
afterEach(async () => {
	await Promise.all(databases.splice(0).map((db) => db.close()));
});

async function fixture() {
	const database = await createTestDatabase();
	databases.push(database);
	const { db, repositories } = database;
	const now = new Date();
	await db.insert(schema.user).values({
		id: "reader",
		name: "Reader",
		email: "reader@example.com",
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	await db
		.insert(schema.organization)
		.values(
			["a", "b"].map((id) => ({ id, name: id, slug: id, createdAt: now })),
		);
	await db.insert(schema.member).values({
		id: "member",
		organizationId: "a",
		userId: "reader",
		role: "viewer",
		createdAt: now,
	});
	const tenant = createTestTenant("a");
	const scope = createTenantScope(tenant);
	const ports = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: repositories,
	});
	const ctx = await createTestContextFactory<AppContext, AppContext["ports"]>({
		ports: ports.ports,
		actor: createTestUserActor("reader"),
		tenant,
		auth: {
			user: {
				id: "reader",
				name: "Reader",
				email: "reader@example.com",
				accessStatus: "approved",
			},
			session: { id: "session", activeOrganizationId: "a" },
		},
		extra: { membership: { role: "viewer" } },
	})();
	const page = (title: string) =>
		repositories.pages.create(scope, {
			title,
			userId: "reader",
			parentPageId: null,
			position: 1,
		});
	const canvas = async (title: string | null, pageId: string | null = null) => {
		const created = await repositories.canvases.create(scope, {
			title,
			pageId,
			userId: "reader",
		});
		if (pageId) {
			const parent = await repositories.pages.findById(scope, pageId);
			await repositories.pages.restoreContent(scope, pageId, [
				...(parent?.content ?? []),
				{
					id: crypto.randomUUID(),
					type: "canvas",
					props: { canvasId: created.id },
					children: [],
				},
			]);
		}
		return created;
	};
	const task = (
		title: string,
		pageId: string | null = null,
		completed = false,
	) =>
		repositories.tasks.create(scope, {
			title,
			pageId,
			completed,
			userId: "reader",
			sourceBlockId: null,
			dueDate: null,
			dueTime: null,
			assigneeId: null,
			completedAt: null,
		});
	const search = (
		query: string,
		extra: {
			kind?: "all" | "page" | "task" | "canvas";
			limit?: number;
			cursor?: string;
			workspaceId?: string;
		} = {},
	) =>
		searchWorkspaceUseCase.run({
			ctx,
			input: { workspaceId: "a", query, ...extra },
		});
	const save = (id: string, store: Record<string, unknown>, revision = 0) =>
		repositories.canvases.commitSyncRoom(scope, {
			id,
			roomJson: "{}",
			snapshotJson: JSON.stringify({ store }),
			baseRevision: revision,
		});
	return { ...database, scope, ctx, page, canvas, task, search, save };
}
const textShape = (id: string, text: string, type = "text") => ({
	id,
	typeName: "shape",
	type,
	props: {
		richText: {
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text }] }],
		},
	},
});

describe("workspace search", () => {
	it("finds all resource types, ranks titles first, and returns navigable excerpts", async () => {
		const f = await fixture();
		const page = await f.page("Release notes");
		await f.repositories.pages.restoreContent(f.scope, page.id, [
			{
				id: "p",
				type: "paragraph",
				props: {},
				children: [],
				content: [
					{ type: "text", text: "The launch plan is ready", styles: {} },
				],
			},
		]);
		const task = await f.task("Launch checklist", page.id, true);
		const canvas = await f.canvas("Architecture", page.id);
		await f.save(canvas.id, {
			"shape:note": textShape("shape:note", "Launch sequence", "note"),
		});
		const result = await f.search("launch");
		expect(result.items).toHaveLength(3);
		expect(result.items[0]?.id).toBe(task.id);
		expect(result.items.find((r) => r.kind === "page")?.snippet).toContain(
			"launch plan",
		);
		const drawing = result.items.find((r) => r.kind === "canvas");
		expect(drawing).toMatchObject({
			id: canvas.id,
			pageId: page.id,
			pageTitle: "Release notes",
			shapeId: "shape:note",
			snippet: "Launch sequence",
		});
		expect(drawing?.path).toContain(
			`/p/${page.id}?canvasId=${canvas.id}&shapeId=shape%3Anote`,
		);
		expect(result.items[0]?.path).toContain(
			"filter=all&scope=everyone&taskId=",
		);
		for (const item of result.items)
			expect(parseWorkspacePath(item.path).workspaceId).toBe("a");
		expect(result.nextCursor).toBeNull();
	});

	it("indexes existing drawings and keeps text fresh even for raw snapshot writes", async () => {
		const f = await fixture();
		const canvas = await f.canvas("Board");
		const store = {
			"shape:frame": {
				id: "shape:frame",
				typeName: "shape",
				type: "frame",
				props: { name: "Planning" },
			},
			"shape:legacy": {
				id: "shape:legacy",
				typeName: "shape",
				type: "text",
				props: { text: "Legacy notes" },
			},
			"shape:note": textShape("shape:note", "Planning notes", "note"),
			"shape:arrow": textShape("shape:arrow", "Arrow label", "arrow"),
			"shape:geo": textShape("shape:geo", "Geo label", "geo"),
			"shape:rich": {
				id: "shape:rich",
				typeName: "shape",
				type: "text",
				props: {
					richText: {
						type: "doc",
						content: [
							{
								type: "paragraph",
								content: [
									{ type: "text", text: "Ship" },
									{ type: "text", text: "ping", marks: [{ type: "bold" }] },
								],
							},
							{
								type: "paragraph",
								content: [{ type: "text", text: "tomorrow" }],
							},
						],
					},
				},
			},
			"asset:image": {
				id: "asset:image",
				typeName: "asset",
				props: {
					src: "https://private.invalid/secret-url",
					name: "hidden filename",
				},
			},
			"shape:image": {
				id: "shape:image",
				typeName: "shape",
				type: "image",
				meta: { text: "hidden metadata" },
				props: { text: "hidden image text" },
			},
		};
		await f.save(canvas.id, store);
		const saved = await f.repositories.canvases.findById(f.scope, canvas.id);
		for (const query of [
			"Planning",
			"Legacy",
			"Arrow label",
			"Geo label",
			"Shipping tomorrow",
		])
			expect((await f.search(query)).items.map((r) => r.id)).toEqual([
				canvas.id,
			]);
		for (const query of ["secret-url", "hidden", "shape:note"])
			expect((await f.search(query)).items).toEqual([]);
		// Reapply the migration to a populated, pre-column database to test backfill.
		await f.client.execute("DROP TRIGGER canvases_search_insert");
		await f.client.execute("DROP TRIGGER canvases_search_update");
		await f.client.execute("ALTER TABLE canvases DROP COLUMN search_content");
		const migration = await readFile(
			"drizzle/0049_cool_kate_bishop.sql",
			"utf8",
		);
		for (const statement of migration.split("--> statement-breakpoint"))
			await f.client.execute(statement);
		expect((await f.search("Shipping tomorrow")).items[0]?.id).toBe(canvas.id);
		expect(await f.repositories.canvases.findById(f.scope, canvas.id)).toEqual(
			saved,
		);
		// Older workers don't know search_content; the trigger still updates it.
		await f.db
			.update(schema.canvases)
			.set({
				snapshot: JSON.stringify({
					store: { "shape:changed": textShape("shape:changed", "New words") },
				}),
			})
			.where(eq(schema.canvases.id, canvas.id));
		expect((await f.search("Planning")).items).toEqual([]);
		expect((await f.search("New words")).items[0]?.shapeId).toBe(
			"shape:changed",
		);
		await f.db
			.update(schema.canvases)
			.set({ snapshot: "{}" })
			.where(eq(schema.canvases.id, canvas.id));
		expect((await f.search("New words")).items).toEqual([]);
	});

	it("searches legacy page body text without exposing URLs or block metadata", async () => {
		const f = await fixture();
		const page = await f.page("Old page");
		await f.db
			.update(schema.pages)
			.set({
				content: JSON.stringify([
					{
						id: "block",
						type: "paragraph",
						props: { text: "private-property" },
						content: [
							{
								type: "link",
								href: "https://hidden-link.invalid",
								content: [{ type: "text", text: "Legacy phrase", styles: {} }],
							},
						],
					},
				]),
				searchText: "",
			})
			.where(eq(schema.pages.id, page.id));
		expect((await f.search("Legacy phrase")).items[0]?.id).toBe(page.id);
		expect((await f.search("private-property")).items).toEqual([]);
		expect((await f.search("hidden-link")).items).toEqual([]);
	});

	it("enforces workspace scope and excludes archived pages and their tasks/drawings", async () => {
		const f = await fixture();
		const page = await f.page("Needle page");
		await f.task("Needle task", page.id);
		await f.canvas("Needle canvas", page.id);
		const standalone = await f.canvas("Needle standalone");
		await f.repositories.pages.create(
			createTenantScope(createTestTenant("b")),
			{
				title: "Needle foreign",
				userId: "reader",
				parentPageId: null,
				position: 1,
			},
		);
		expect((await f.search("Needle")).items).toHaveLength(4);
		await f.db
			.update(schema.pages)
			.set({ deletedAt: new Date().toISOString() })
			.where(eq(schema.pages.id, page.id));
		expect((await f.search("Needle")).items.map((r) => r.id)).toEqual([
			standalone.id,
		]);
		await expect(f.search("Needle", { workspaceId: "b" })).rejects.toThrow(
			"access to this workspace",
		);
		await expect(
			searchWorkspaceUseCase.run({
				ctx: { ...f.ctx, auth: null },
				input: { workspaceId: "a", query: "Needle" },
			}),
		).rejects.toThrow();
	});

	it("does not return a retained drawing whose block was removed from its page", async () => {
		const f = await fixture();
		const page = await f.page("Parent");
		await f.canvas("Needle diagram", page.id);
		expect((await f.search("Needle")).items).toHaveLength(1);
		await f.repositories.pages.restoreContent(f.scope, page.id, []);
		expect((await f.search("Needle")).items).toEqual([]);
	});

	it("paginates deterministically across all types without an early candidate cap", async () => {
		const f = await fixture();
		for (let i = 0; i < 105; i++) await f.page(`Match ${i}`);
		await f.task("Match task");
		await f.canvas("Match board");
		await f.db
			.update(schema.pages)
			.set({ updatedAt: "2026-01-01T00:00:00.000Z" });
		const ids = new Set<string>();
		let cursor: string | undefined;
		do {
			const result = await f.search("Match", { limit: 17, cursor });
			for (const item of result.items) {
				expect(ids.has(item.id)).toBeFalse();
				ids.add(item.id);
			}
			cursor = result.nextCursor ?? undefined;
		} while (cursor);
		expect(ids.size).toBe(107);
		expect((await f.search("Match", { kind: "canvas" })).items).toHaveLength(1);
		const first = await f.search("Match", { limit: 1 });
		await expect(
			f.search("Other", { cursor: first.nextCursor! }),
		).rejects.toThrow("cursor");
		await expect(
			f.search("Match", { kind: "task", cursor: first.nextCursor! }),
		).rejects.toThrow("cursor");
		await expect(f.search("Match", { cursor: "garbage" })).rejects.toThrow(
			"cursor",
		);
	});

	it("treats wildcard and SQL characters literally and bounds input", async () => {
		const f = await fixture();
		const exact = await f.page("100%_ready\\'done");
		await f.page("100xxready");
		expect((await f.search("%_ready\\'")).items.map((r) => r.id)).toEqual([
			exact.id,
		]);
		expect((await f.search("' OR 1=1 --")).items).toEqual([]);
		for (const query of [" ", "a", "x".repeat(201)])
			expect(
				SearchWorkspaceInputSchema.safeParse({ workspaceId: "a", query })
					.success,
			).toBeFalse();
		expect(
			SearchWorkspaceInputSchema.safeParse({
				workspaceId: "a",
				query: "ok",
				limit: 51,
			}).success,
		).toBeFalse();
	});

	it("registers the same read-only search for MCP and requires a workspace grant", () => {
		expect(agentCapabilityRegistry.definitions).toContain(
			searchWorkspaceCapability,
		);
		expect(AGENT_PERMISSION_PROFILES.view.capabilities).toContain(
			"search_workspace",
		);
		expect(
			agentCapabilityMetadata.search_workspace.requiredConstraints,
		).toEqual(["workspaceId"]);
	});
});
