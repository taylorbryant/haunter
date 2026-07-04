import { describe, expect, it } from "bun:test";
import { createMemoryRateLimiter, createStaticAuth } from "@beignet/core/ports";
import {
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
import { appPorts } from "@/infra/app-ports";
import type { AppPorts, AppTransactionPorts } from "@/ports";
import type { AuthRequest, AuthSessionMetadata, AuthUser } from "@/ports/auth";
import { type AppServiceContextInput, appContext } from "@/server/context";
import { createPageShare } from "../contracts";
import { shareRoutes } from "../routes";
import { createTestShareRepository } from "./helpers";

/**
 * Route-level proof that contract.meta.rateLimit is enforced end to end:
 * createPageShare allows 30 hits per user per minute, so the 31st must 429.
 */
describe("shareRoutes rate limiting", () => {
	it("returns 429 once the per-user limit is exhausted", async () => {
		const workspaceId = crypto.randomUUID().replaceAll("-", "");
		const pages = createTestPageRepository();
		const shares = createTestShareRepository();
		const page = await pages.create({
			userId: "user_test",
			workspaceId,
			parentPageId: null,
			title: "Limited",
			position: 1,
		});

		const auth: AppPorts["auth"] = createStaticAuth<
			AuthUser,
			AuthSessionMetadata,
			AuthRequest
		>({
			user: { id: "user_test", email: "user_test@example.com", name: "Test" },
			session: { id: "session_test", activeOrganizationId: workspaceId },
		});
		const members = {
			async findRole() {
				return "owner";
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
				canvases: createTestCanvasRepository(),
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
				createIdempotencyHooks<AppContext>(),
				// shareRoutes registers ip-scoped public contracts, so an ipSource
				// is mandatory; "none" shares one bucket, fine for this test.
				createRateLimitHooks<AppContext>({ ipSource: "none" }),
			],
			routes: defineRoutes<AppContext>([shareRoutes]),
		});
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
