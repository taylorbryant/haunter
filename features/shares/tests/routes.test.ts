import { describe, expect, it } from "bun:test";
import {
	createMemoryRateLimiter,
	createStaticAuth,
	createTenant,
	createTenantScope,
} from "@beignet/core/ports";
import {
	createCsrfHooks,
	createIdempotencyHooks,
	createRateLimitHooks,
	defineRoutes,
} from "@beignet/core/server";
import { createTestPorts } from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import { createTestApp, createTestRequester } from "@beignet/web/testing";
import type { AppContext } from "@/app-context";
import { createTestCanvasRepository } from "@/features/canvases/tests/helpers";
import { createTestPageRepository } from "@/features/pages/tests/helpers";
import { appPorts } from "@/infra/port-wiring";
import type { AppPorts, AppTransactionPorts } from "@/ports";
import {
	ACCESS_STATUS_APPROVED,
	type AuthRequest,
	type AuthSessionMetadata,
	type AuthUser,
} from "@/ports/auth";
import { type AppServiceContextInput, appContext } from "@/server/context";
import { createPageShare, getPageShare, getSharedPage } from "../contracts";
import { sharedCanvasResponseHooks, shareRoutes } from "../routes";
import { createTestShareRepository } from "./helpers";

/**
 * Route-level proof that contract.meta.rateLimit is enforced end to end:
 * createPageShare allows 30 hits per user per minute, so the 31st must 429.
 */
async function createShareRouteTestApp(
	createAuth: (workspaceId: string) => AppPorts["auth"],
) {
	const workspaceId = crypto.randomUUID().replaceAll("-", "");
	const auth = createAuth(workspaceId);
	const pages = createTestPageRepository();
	const shares = createTestShareRepository();
	const canvases = createTestCanvasRepository();
	const scope = createTenantScope(createTenant(workspaceId));
	const page = await pages.create(scope, {
		userId: "user_test",
		parentPageId: null,
		title: "Limited",
		position: 1,
	});

	const members = {
		async findRole() {
			return "owner";
		},
		async listForUser() {
			return [];
		},
		async listByWorkspace() {
			return [];
		},
	};
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			auth,
			members,
			pages,
			shares,
			canvases,
			rateLimit: createMemoryRateLimiter(),
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({ ...ports, members, pages, shares }),
		},
	});

	const app = await createTestApp<
		AppContext,
		AppContext["ports"],
		AppServiceContextInput
	>({
		ports: fixture.ports,
		context: appContext,
		hooks: [
			sharedCanvasResponseHooks,
			createCsrfHooks<AppContext>(),
			createIdempotencyHooks<AppContext>(),
			// shareRoutes registers ip-scoped public contracts, so an ipSource
			// is mandatory; "none" shares one bucket, fine for this test.
			createRateLimitHooks<AppContext>({ ipSource: "none" }),
		],
		routes: defineRoutes<AppContext>([shareRoutes]),
	});

	return { app, page, pages, canvases, scope, shares, workspaceId };
}

describe("shareRoutes hooks", () => {
	it("rechecks canvas references on anonymous reads and prevents caching success or errors", async () => {
		const { app, page, pages, canvases, scope, shares } =
			await createShareRouteTestApp(() =>
				createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>(null),
			);
		try {
			const canvas = await canvases.create(scope, {
				userId: "user_test",
				pageId: page.id,
				title: null,
			});
			const content = JSON.stringify([
				{
					id: "canvas",
					type: "canvas",
					props: { canvasId: canvas.id },
					children: [],
				},
			]);
			await pages.saveContent(scope, page.id, content, "");
			const token = "public-canvas-token";
			await shares.create(scope, {
				pageId: page.id,
				token,
				createdBy: "user_test",
			});
			const url = `http://localhost/api/shared/${token}/canvases/${canvas.id}`;
			const visible = await app.fetch(url);
			expect(visible.status).toBe(200);
			expect(visible.headers.get("cache-control")).toBe("no-store");
			expect(await visible.json()).toEqual({ snapshot: {} });
			await pages.saveContent(scope, page.id, "[]", "");
			const removed = await app.fetch(url);
			expect(removed.status).toBe(404);
			expect(removed.headers.get("cache-control")).toBe("no-store");
			expect(await removed.json()).toMatchObject({ code: "SHARE_NOT_FOUND" });
			await pages.saveContent(scope, page.id, content, "");
			const restored = await app.fetch(url);
			expect(restored.status).toBe(200);
			expect(restored.headers.get("cache-control")).toBe("no-store");
			await shares.deleteByPage(scope, page.id);
			const revoked = await app.fetch(url);
			expect(revoked.status).toBe(404);
			expect(revoked.headers.get("cache-control")).toBe("no-store");
			const invalidId = await app.fetch(
				`http://localhost/api/shared/${token}/canvases/not-a-uuid`,
			);
			expect(invalidId.status).toBe(422);
			expect(invalidId.headers.get("cache-control")).toBe("no-store");
		} finally {
			await app.stop();
		}
	});

	it("keeps rate-limited public canvas responses uncacheable", async () => {
		const { app } = await createShareRouteTestApp(() =>
			createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>(null),
		);
		try {
			const url = `http://localhost/api/shared/unknown-token/canvases/${crypto.randomUUID()}`;
			for (let i = 0; i < 240; i++)
				expect((await app.fetch(url)).status).toBe(404);
			const limited = await app.fetch(url);
			expect(limited.status).toBe(429);
			expect(limited.headers.get("cache-control")).toBe("no-store");
		} finally {
			await app.stop();
		}
	});

	it("keeps token reads public and protects share management", async () => {
		expect(getPageShare.metadata.auth).toBe("required");
		expect(getSharedPage.metadata.auth).toBeUndefined();

		const { app, page, scope, shares } = await createShareRouteTestApp(() =>
			createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>(null),
		);
		const token = "public-share-token";
		await shares.create(scope, {
			pageId: page.id,
			token,
			createdBy: "user_test",
		});
		const requester = createTestRequester(app, {});

		const shared = await requester.request(getSharedPage, {
			path: { token },
		});
		const managed = await requester.safeRequest(getPageShare, {
			path: { pageId: page.id },
		});

		await app.stop();

		expect(shared.title).toBe("Limited");
		expect(managed.ok).toBe(false);
		if (managed.ok) throw new Error("Expected an unauthenticated result.");
		expect(managed.status).toBe(401);
	});

	it("returns 429 once the per-user limit is exhausted", async () => {
		const { app, page } = await createShareRouteTestApp((workspaceId) =>
			createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>({
				user: {
					id: "user_test",
					email: "user_test@example.com",
					name: "Test",
					accessStatus: ACCESS_STATUS_APPROVED,
				},
				session: {
					id: "session_test",
					activeOrganizationId: workspaceId,
				},
			}),
		);
		const requester = createTestRequester(app, {});

		// The declared limit: 30/user/minute. Idempotent creates keep it cheap.
		for (let i = 0; i < 30; i += 1) {
			await requester.request(createPageShare, {
				path: { pageId: page.id },
				body: {},
			});
		}

		const blocked = await requester.safeRequest(createPageShare, {
			path: { pageId: page.id },
			body: {},
		});

		await app.stop();

		expect(blocked.ok).toBe(false);
		if (blocked.ok) throw new Error("Expected a rate-limited result.");
		expect(blocked.status).toBe(429);
	});
});
