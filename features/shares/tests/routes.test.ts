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
import {
	createTestDocumentRegistryRepository,
	createTestDocumentStore,
} from "@/features/documents/tests/helpers";
import { createTestPageRepository } from "@/features/pages/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import type { AppPorts, AppTransactionPorts } from "@/ports";
import {
	ACCESS_STATUS_APPROVED,
	type AuthRequest,
	type AuthSessionMetadata,
	type AuthUser,
} from "@/ports/auth";
import { type AppServiceContextInput, appContext } from "@/server/context";
import { createPageShare, getPageShare, getSharedPage } from "../contracts";
import { shareRoutes } from "../routes";
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
	const documents = createTestDocumentRegistryRepository();
	const documentStore = createTestDocumentStore();
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
			documents,
			documentStore,
			members,
			pages,
			shares,
			canvases: createTestCanvasRepository(),
			rateLimit: createMemoryRateLimiter(),
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({
				...ports,
				documents,
				members,
				pages,
				shares,
			}),
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
			createCsrfHooks<AppContext>(),
			createIdempotencyHooks<AppContext>(),
			// shareRoutes registers ip-scoped public contracts, so an ipSource
			// is mandatory; "none" shares one bucket, fine for this test.
			createRateLimitHooks<AppContext>({ ipSource: "none" }),
		],
		routes: defineRoutes<AppContext>([shareRoutes]),
	});

	return { app, page, scope, shares, workspaceId };
}

describe("shareRoutes hooks", () => {
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
