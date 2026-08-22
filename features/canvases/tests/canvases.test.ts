import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTenantScope } from "@beignet/core/ports";
import {
	createTestContextFactory,
	createTestPorts,
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import type {
	CanvasNavigationRepository,
	CanvasRepository,
} from "@/features/canvases/ports";
import type { PageRepository } from "@/features/pages/ports";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
} from "@/features/pages/tests/helpers";
import { purgePageUseCase } from "@/features/pages/use-cases";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/port-wiring";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";
import {
	createCanvasUseCase,
	deleteCanvasUseCase,
	getCanvasNavigationUseCase,
	getCanvasUseCase,
	listCanvasesUseCase,
	recordCanvasViewUseCase,
	saveCanvasSnapshotUseCase,
	setCanvasFavoriteUseCase,
	updateCanvasUseCase,
} from "../use-cases";
import {
	createTestCanvasNavigationRepository,
	createTestCanvasRepository,
} from "./helpers";

function createTester(
	userId: string,
	repos: {
		canvasNavigation: CanvasNavigationRepository;
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
	const canvasNavigation = createTestCanvasNavigationRepository({ canvases });
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
	const tester = createTester(
		userId,
		{ canvasNavigation, canvases, pages },
		workspace.id,
	);
	const ctx = await tester.ctx();

	return {
		canvasNavigation,
		canvases,
		pages,
		workspace,
		scope,
		page,
		tester,
		ctx,
	};
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
		expect(canvas.pageId).toBe(page.id);
		expect(canvas.title).toBeNull();

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
		expect(saved.snapshotUpdatedAt > canvas.snapshotUpdatedAt).toBe(true);

		const fetched = await tester.run(
			getCanvasUseCase,
			{ id: canvas.id },
			{ ctx },
		);
		expect(fetched.snapshot).toEqual(snapshot);
	});

	it("creates, lists, renames, saves, and deletes standalone canvases", async () => {
		const { workspace, page, tester, ctx } = await createFixture();
		await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, pageId: page.id },
			{ ctx },
		);

		const canvas = await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, title: "System map" },
			{ ctx },
		);
		expect(canvas.pageId).toBeNull();
		expect(canvas.title).toBe("System map");

		const listed = await tester.run(
			listCanvasesUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);
		expect(listed.items).toHaveLength(1);
		expect(listed.items[0]?.id).toBe(canvas.id);
		expect(listed.items[0]).not.toHaveProperty("snapshot");

		const renamed = await tester.run(
			updateCanvasUseCase,
			{ id: canvas.id, title: "Architecture map" },
			{ ctx },
		);
		expect(renamed.title).toBe("Architecture map");

		await tester.run(
			saveCanvasSnapshotUseCase,
			{ id: canvas.id, snapshot: { standalone: true } },
			{ ctx },
		);
		expect(
			(await tester.run(getCanvasUseCase, { id: canvas.id }, { ctx })).snapshot,
		).toEqual({ standalone: true });

		await tester.run(deleteCanvasUseCase, { id: canvas.id }, { ctx });
		await expect(
			tester.run(getCanvasUseCase, { id: canvas.id }, { ctx }),
		).rejects.toThrow("Canvas not found");
	});

	it("keeps standalone canvas favorites personal and records recent views", async () => {
		const { canvasNavigation, canvases, pages, workspace, tester, ctx } =
			await createFixture();
		const canvas = await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, title: "System map" },
			{ ctx },
		);

		await tester.run(
			setCanvasFavoriteUseCase,
			{ id: canvas.id, favorite: true },
			{ ctx },
		);
		await tester.run(recordCanvasViewUseCase, { id: canvas.id }, { ctx });

		const navigation = await tester.run(
			getCanvasNavigationUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);
		expect(navigation.favorites.map((item) => item.id)).toEqual([canvas.id]);
		expect(navigation.recents.map((item) => item.id)).toEqual([canvas.id]);

		const viewer = createTester(
			"user_viewer",
			{ canvasNavigation, canvases, pages },
			workspace.id,
		);
		const viewerCtx = await viewer.ctx();
		expect(
			await viewer.run(
				getCanvasNavigationUseCase,
				{ workspaceId: workspace.id },
				{ ctx: viewerCtx },
			),
		).toEqual({ favorites: [], recents: [] });
	});

	it("keeps page-owned canvases managed by their page", async () => {
		const { workspace, page, tester, ctx } = await createFixture();
		const canvas = await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, pageId: page.id },
			{ ctx },
		);

		await expect(
			tester.run(
				updateCanvasUseCase,
				{ id: canvas.id, title: "Detached" },
				{ ctx },
			),
		).rejects.toThrow("lives in a page");
		await expect(
			tester.run(deleteCanvasUseCase, { id: canvas.id }, { ctx }),
		).rejects.toThrow("lives in a page");
		await expect(
			tester.run(
				setCanvasFavoriteUseCase,
				{ id: canvas.id, favorite: true },
				{ ctx },
			),
		).rejects.toThrow("lives in a page");
		await expect(
			tester.run(recordCanvasViewUseCase, { id: canvas.id }, { ctx }),
		).rejects.toThrow("lives in a page");
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
				baseUpdatedAt: canvas.snapshotUpdatedAt,
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
					baseUpdatedAt: canvas.snapshotUpdatedAt,
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
				baseUpdatedAt: first.snapshotUpdatedAt,
			},
			{ ctx },
		);
		expect(rebased.snapshotUpdatedAt > first.snapshotUpdatedAt).toBe(true);
	});

	it("keeps a drawing save valid after standalone canvas metadata changes", async () => {
		const { workspace, tester, ctx } = await createFixture();
		const canvas = await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, title: "System map" },
			{ ctx },
		);

		const renamed = await tester.run(
			updateCanvasUseCase,
			{ id: canvas.id, title: "Architecture map" },
			{ ctx },
		);
		expect(renamed.snapshotUpdatedAt).toBe(canvas.snapshotUpdatedAt);

		await expect(
			tester.run(
				saveCanvasSnapshotUseCase,
				{
					id: canvas.id,
					snapshot: { afterRename: true },
					baseUpdatedAt: canvas.snapshotUpdatedAt,
				},
				{ ctx },
			),
		).resolves.toEqual(
			expect.objectContaining({
				snapshotUpdatedAt: expect.any(String),
			}),
		);
	});

	it("rejects creating a canvas on a page in another workspace", async () => {
		const { canvasNavigation, canvases, pages, workspace, page } =
			await createFixture("user_owner");

		const intruder = createTester(
			"user_intruder",
			{ canvasNavigation, canvases, pages },
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
		const { canvasNavigation, canvases, pages, workspace, page, tester, ctx } =
			await createFixture("user_owner");

		const canvas = await tester.run(
			createCanvasUseCase,
			{ workspaceId: workspace.id, pageId: page.id },
			{ ctx },
		);

		const intruder = createTester(
			"user_intruder",
			{ canvasNavigation, canvases, pages },
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
