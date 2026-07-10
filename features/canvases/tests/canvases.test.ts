import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTenantScope } from "@beignet/core/ports";
import {
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/ports/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import type { CanvasRepository } from "@/features/canvases/ports";
import type { PageRepository } from "@/features/pages/ports";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
} from "@/features/pages/tests/helpers";
import { purgePageUseCase } from "@/features/pages/use-cases";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";
import {
	createCanvasUseCase,
	getCanvasUseCase,
	saveCanvasSnapshotUseCase,
} from "../use-cases";
import { createTestCanvasRepository } from "./helpers";

function createTester(
	userId: string,
	repos: {
		canvases: CanvasRepository;
		pages: PageRepository;
	},
	workspaceId: string,
) {
	const tasks = createTestTaskRepository();
	const auth = {
		user: {
			id: userId,
			email: `${userId}@example.com`,
			name: "Test User",
			accessStatus: ACCESS_STATUS_APPROVED,
		},
		session: { id: `session_${userId}`, activeOrganizationId: workspaceId },
	};
	const pageLinks = createTestPageLinkRepository({ pages: repos.pages });
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			...repos,
			pageLinks,
			tasks,
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({ ...ports, ...repos, pageLinks, tasks }),
		},
	});
	const createTestContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: fixture.ports,
		actor: createTestUserActor(userId, { displayName: auth.user.name }),
		auth,
		tenant: createTestTenant(workspaceId),
		extra: { membership: { role: "owner" } },
	});

	return createUseCaseTester<AppContext>(createTestContext);
}

async function createFixture(userId = "user_test") {
	const canvases = createTestCanvasRepository();
	const pages = createTestPageRepository();
	// Better Auth org ids are nanoid-style, not UUIDs.
	const workspace = {
		id: crypto.randomUUID().replaceAll("-", ""),
		name: "Work",
	};
	const scope = createTenantScope(createTestTenant(workspace.id));
	const page = await pages.create(scope, {
		userId,
		parentPageId: null,
		title: "Diagrams",
		position: 1,
	});
	const tester = createTester(userId, { canvases, pages }, workspace.id);
	const ctx = await tester.ctx();

	return { canvases, pages, workspace, scope, page, tester, ctx };
}

describe("canvases use cases", () => {
	it("creates a canvas, saves snapshots, and reads them back", async () => {
		const { workspace, page, tester, ctx } = await createFixture();

		const canvas = await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, pageId: page.id },
			{ ctx },
		);
		expect(canvas.snapshot).toEqual({});

		const snapshot = {
			store: { "shape:abc": { type: "geo", x: 10, y: 20 } },
			schema: { schemaVersion: 2 },
		};
		const saved = await tester.run(
			saveCanvasSnapshotUseCase,
			{ id: canvas.id, snapshot },
			{ ctx },
		);
		expect(saved.updatedAt >= canvas.updatedAt).toBe(true);

		const fetched = await tester.run(
			getCanvasUseCase,
			{ id: canvas.id },
			{ ctx },
		);
		expect(fetched.snapshot).toEqual(snapshot);
	});

	it("rejects a stale snapshot save and accepts a rebased one", async () => {
		const { workspace, page, tester, ctx } = await createFixture();

		const canvas = await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, pageId: page.id },
			{ ctx },
		);

		const first = await tester.run(
			saveCanvasSnapshotUseCase,
			{
				id: canvas.id,
				snapshot: { v: 1 },
				baseUpdatedAt: canvas.updatedAt,
			},
			{ ctx },
		);

		// A second writer still holding the created version must not clobber.
		await expect(
			tester.run(
				saveCanvasSnapshotUseCase,
				{
					id: canvas.id,
					snapshot: { v: 2 },
					baseUpdatedAt: canvas.updatedAt,
				},
				{ ctx },
			),
		).rejects.toThrow(/changed since/);

		// Rebased on the current version, the save lands.
		const rebased = await tester.run(
			saveCanvasSnapshotUseCase,
			{
				id: canvas.id,
				snapshot: { v: 3 },
				baseUpdatedAt: first.updatedAt,
			},
			{ ctx },
		);
		expect(rebased.updatedAt > first.updatedAt).toBe(true);
	});

	it("rejects creating a canvas on a page in another workspace", async () => {
		const { canvases, pages, workspace, page } =
			await createFixture("user_owner");

		const intruder = createTester(
			"user_intruder",
			{ canvases, pages },
			crypto.randomUUID(),
		);
		const intruderCtx = await intruder.ctx();

		await expect(
			intruder.run(
				createCanvasUseCase,
				{ workspaceId: workspace.id, pageId: page.id },
				{ ctx: intruderCtx },
			),
		).rejects.toThrow("You do not have access to this workspace.");
	});

	it("treats a canvas in another workspace as not found", async () => {
		const { canvases, pages, workspace, page, tester, ctx } =
			await createFixture("user_owner");

		const canvas = await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, pageId: page.id },
			{ ctx },
		);

		const intruder = createTester(
			"user_intruder",
			{ canvases, pages },
			crypto.randomUUID(),
		);
		const intruderCtx = await intruder.ctx();

		await expect(
			intruder.run(getCanvasUseCase, { id: canvas.id }, { ctx: intruderCtx }),
		).rejects.toThrow("Canvas not found");
	});

	it("treats canvases on trashed pages as gone", async () => {
		const { pages, workspace, scope, page, tester, ctx } =
			await createFixture();
		const canvas = await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, pageId: page.id },
			{ ctx },
		);

		await pages.setDeletedByIds(scope, [page.id], new Date().toISOString());

		await expect(
			tester.run(getCanvasUseCase, { id: canvas.id }, { ctx }),
		).rejects.toThrow("Canvas not found");
		await expect(
			tester.run(
				saveCanvasSnapshotUseCase,
				{ id: canvas.id, snapshot: { v: 1 } },
				{ ctx },
			),
		).rejects.toThrow("Canvas not found");
		await expect(
			tester.run(
				createCanvasUseCase,
				{ workspaceId: workspace.id, pageId: page.id },
				{ ctx },
			),
		).rejects.toThrow("Page not found");
	});

	it("deletes a page's canvases when the page is purged", async () => {
		const { canvases, workspace, scope, page, tester, ctx } =
			await createFixture();

		const canvas = await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, pageId: page.id },
			{ ctx },
		);

		await tester.run(purgePageUseCase, { id: page.id }, { ctx });

		expect(await canvases.findById(scope, canvas.id)).toBeNull();
	});
});
