import { describe, expect, it } from "bun:test";
import { createMemoryRateLimiter, createStaticAuth } from "@beignet/core/ports";
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
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import type { AppPorts, AppTransactionPorts } from "@/ports";
import {
	ACCESS_STATUS_APPROVED,
	type AuthRequest,
	type AuthSessionMetadata,
	type AuthUser,
} from "@/ports/auth";
import { type AppServiceContextInput, appContext } from "@/server/context";
import { createPage, listPages, searchPages } from "../contracts";
import { pageRoutes } from "../routes";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
	createTestPageVersionRepository,
} from "./helpers";

/**
 * Route-hook coverage: the harness defaults `onUnboundPorts` to "ignore", so
 * rate-limit and idempotency hooks silently no-op unless their ports are
 * bound. These tests bind them and assert the hooks actually enforce —
 * a contract's `meta.rateLimit` 429s past the limit, and an idempotency key
 * replays instead of re-executing.
 */
async function createHookedTestApp(options: { auth: AppPorts["auth"] }) {
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository();
	const canvases = createTestCanvasRepository();
	const pageLinks = createTestPageLinkRepository({ pages });
	const pageVersions = createTestPageVersionRepository();
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
			members,
			pageLinks,
			pages,
			pageVersions,
			tasks,
			canvases,
			devtools: createInMemoryDevtools(),
			auth: options.auth,
			// The point of this file: with the port bound, meta.rateLimit is
			// enforced by the hook instead of silently ignored.
			rateLimit: createMemoryRateLimiter(),
		},
		transaction: {
			ports: (ports) => ({
				...ports,
				pageVersions,
				members,
				pageLinks,
				pages,
				tasks,
				canvases,
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
			createRateLimitHooks<AppContext>({ ipSource: "x-forwarded-for-first" }),
		],
		routes: defineRoutes<AppContext>([pageRoutes]),
	});

	return { app };
}

function createSignedInAuth(
	userId: string,
	workspaceId: string,
): AppPorts["auth"] {
	return createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>({
		user: {
			id: userId,
			email: `${userId}@example.com`,
			name: "Test User",
			accessStatus: ACCESS_STATUS_APPROVED,
		},
		session: { id: `session_${userId}`, activeOrganizationId: workspaceId },
	});
}

describe("page route hooks", () => {
	it("rejects a cross-origin mutation", async () => {
		const workspace = { id: crypto.randomUUID().replaceAll("-", "") };
		const { app } = await createHookedTestApp({
			auth: createSignedInAuth("user_csrf", workspace.id),
		});

		const response = await app.fetch("http://beignet.test/api/pages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "https://attacker.example",
			},
			body: JSON.stringify({ workspaceId: workspace.id, title: "Blocked" }),
		});
		const body = (await response.json()) as {
			code?: string;
			details?: { reason?: string };
		};

		await app.stop();

		expect(response.status).toBe(403);
		expect(body.code).toBe("FORBIDDEN");
		expect(body.details?.reason).toBe("untrusted_origin");
	});

	it("enforces meta.rateLimit with a 429 past the limit", async () => {
		const workspace = { id: crypto.randomUUID().replaceAll("-", "") };
		const { app } = await createHookedTestApp({
			auth: createSignedInAuth("user_limit", workspace.id),
		});
		const requester = createTestRequester(app, {});

		// searchPages is declared max 60 per 60s per user; burn the budget.
		for (let i = 0; i < 60; i++) {
			await requester.request(searchPages, {
				query: { q: `probe ${i}` },
			});
		}

		// Raw fetch for the 61st call so the response headers are inspectable.
		const response = await app.fetch(
			"http://beignet.test/api/search?q=one-too-many",
			{ method: "GET" },
		);

		const body = (await response.json()) as {
			code?: string;
			details?: { retryAfterSeconds?: number };
		};

		await app.stop();

		expect(response.status).toBe(429);
		expect(body.code).toBe("TOO_MANY_REQUESTS");
		expect(body.details?.retryAfterSeconds).toBeGreaterThan(0);
		// Since 0.0.30 the hook also sets the standard header, so generic
		// clients can back off without parsing the error body.
		expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
	});

	it("replays an idempotent create instead of re-executing it", async () => {
		const workspace = { id: crypto.randomUUID().replaceAll("-", "") };
		const { app } = await createHookedTestApp({
			auth: createSignedInAuth("user_idem", workspace.id),
		});
		const requester = createTestRequester(app, {});

		const first = await requester.request(createPage, {
			body: { workspaceId: workspace.id, title: "Once only" },
			idempotencyKey: "hooks-idem-1",
		});
		const replay = await requester.request(createPage, {
			body: { workspaceId: workspace.id, title: "Once only" },
			idempotencyKey: "hooks-idem-1",
		});
		const listed = await requester.request(listPages, {
			path: { workspaceId: workspace.id },
		});

		await app.stop();

		// Same response, and — the part that matters — no second page row.
		expect(replay.id).toBe(first.id);
		expect(listed.items).toHaveLength(1);
	});
});
