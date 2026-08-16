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
import {
	createTestTaskIntegration,
	createTestTaskRepository,
} from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/port-wiring";
import type { AppPorts, AppTransactionPorts } from "@/ports";
import {
	ACCESS_STATUS_APPROVED,
	ACCESS_STATUS_WAITLISTED,
	type AuthRequest,
	type AuthSessionMetadata,
	type AuthUser,
} from "@/ports/auth";
import { type AppServiceContextInput, appContext } from "@/server/context";
import {
	createPage,
	deletePage,
	getPage,
	getPageNavigation,
	listPages,
	recordPageView,
	savePageContent,
	setPageFavorite,
	updatePage,
} from "../contracts";
import { pageRoutes } from "../routes";
import {
	createTestPageLinkRepository,
	createTestPageNavigationRepository,
	createTestPageRepository,
	createTestPageVersionRepository,
	createTestWorkspaceEventPublisher,
} from "./helpers";

function createSignedInAuth(
	userId: string,
	workspaceId: string,
	accessStatus = ACCESS_STATUS_APPROVED,
): AppPorts["auth"] {
	return createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>({
		user: {
			id: userId,
			email: `${userId}@example.com`,
			name: "Test User",
			accessStatus,
		},
		// The active organization is the request tenant.
		session: { id: `session_${userId}`, activeOrganizationId: workspaceId },
	});
}

async function createPagesTestApp(options: {
	auth: AppPorts["auth"];
	membershipRole?: string | null;
}) {
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository();
	const canvases = createTestCanvasRepository();
	const pageLinks = createTestPageLinkRepository({ pages });
	const pageNavigation = createTestPageNavigationRepository({ pages });
	const pageVersions = createTestPageVersionRepository();
	const workspaceEvents = createTestWorkspaceEventPublisher();
	const membershipRole =
		options.membershipRole === undefined ? "owner" : options.membershipRole;
	const members = {
		async findRole() {
			return membershipRole;
		},
		async listForUser() {
			return [];
		},
		async listByWorkspace() {
			return [];
		},
	};
	const taskIntegration = createTestTaskIntegration({
		documents: pages,
		members,
		tasks,
	});
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			members,
			pageLinks,
			pageNavigation,
			pages,
			pageVersions,
			...taskIntegration,
			tasks,
			canvases,
			workspaceEvents,
			devtools: createInMemoryDevtools(),
			auth: options.auth,
			// Bound so the harness's unenforceable-metadata warning stays quiet;
			// the 429 behavior itself is asserted in route-hooks.test.ts.
			rateLimit: createMemoryRateLimiter(),
		},
		transaction: {
			ports: (ports) => ({
				...ports,
				pageVersions,
				...taskIntegration,
				members,
				pageLinks,
				pageNavigation,
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
			createIdempotencyHooks<AppContext>(),
			createRateLimitHooks<AppContext>({ ipSource: "none" }),
		],
		routes: defineRoutes<AppContext>([pageRoutes]),
	});

	return { app };
}

describe("pageRoutes", () => {
	it("does not authorize a stale active organization without membership", async () => {
		const workspaceId = crypto.randomUUID().replaceAll("-", "");
		const { app } = await createPagesTestApp({
			auth: createSignedInAuth("user_removed", workspaceId),
			membershipRole: null,
		});
		const requester = createTestRequester(app, {});

		const result = await requester.safeRequest(listPages, {
			path: { workspaceId },
		});

		await app.stop();

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected an error result.");
		expect(result.status).toBe(403);
		expect(result.error.message).toBe("Select a workspace before continuing.");
	});

	it("authorizes an accepted member who is still app-waitlisted", async () => {
		const workspaceId = crypto.randomUUID().replaceAll("-", "");
		const { app } = await createPagesTestApp({
			auth: createSignedInAuth(
				"user_invited",
				workspaceId,
				ACCESS_STATUS_WAITLISTED,
			),
			membershipRole: "member",
		});
		const requester = createTestRequester(app, {});

		const created = await requester.request(createPage, {
			body: { workspaceId, title: "Shared notes" },
			idempotencyKey: "accepted-member-create",
		});

		await app.stop();

		expect(created.title).toBe("Shared notes");
	});

	it("does not treat a pending invitation as membership", async () => {
		const workspaceId = crypto.randomUUID().replaceAll("-", "");
		const { app } = await createPagesTestApp({
			auth: createSignedInAuth(
				"user_pending_invite",
				workspaceId,
				ACCESS_STATUS_WAITLISTED,
			),
			membershipRole: null,
		});
		const requester = createTestRequester(app, {});

		const result = await requester.safeRequest(listPages, {
			path: { workspaceId },
		});

		await app.stop();

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected an error result.");
		expect(result.status).toBe(403);
		expect(result.error.message).toBe("Your account is still on the waitlist.");
	});

	it("manages personal favorites and recent views over HTTP", async () => {
		const workspace = { id: crypto.randomUUID().replaceAll("-", "") };
		const { app } = await createPagesTestApp({
			auth: createSignedInAuth("user_test", workspace.id),
		});
		const requester = createTestRequester(app, {});
		const created = await requester.request(createPage, {
			body: { workspaceId: workspace.id, title: "Pinned page" },
			idempotencyKey: "page-navigation-create",
		});

		await requester.request(setPageFavorite, {
			path: { id: created.id },
			body: { favorite: true },
		});
		await requester.request(recordPageView, {
			path: { id: created.id },
			body: {},
		});
		const navigation = await requester.request(getPageNavigation, {
			path: { workspaceId: workspace.id },
		});

		await app.stop();

		expect(navigation.favorites.map((page) => page.id)).toEqual([created.id]);
		expect(navigation.recents.map((page) => page.id)).toEqual([created.id]);
	});

	it("rejects an excessively nested initial document over HTTP", async () => {
		const workspace = { id: crypto.randomUUID().replaceAll("-", "") };
		const { app } = await createPagesTestApp({
			auth: createSignedInAuth("user_test", workspace.id),
		});
		let content: {
			id: string;
			type: string;
			props: Record<string, unknown>;
			children: unknown[];
		} = { id: "leaf", type: "paragraph", props: {}, children: [] };
		for (let depth = 0; depth < 64; depth += 1) {
			content = {
				id: `parent-${depth}`,
				type: "paragraph",
				props: {},
				children: [content],
			};
		}

		const response = await app.fetch("http://beignet.test/api/pages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				workspaceId: workspace.id,
				title: "Too deep",
				initialContent: [content],
			}),
		});

		await app.stop();

		expect(response.status).toBe(422);
	});

	it("creates a page with initial content over HTTP", async () => {
		const workspace = { id: crypto.randomUUID().replaceAll("-", "") };
		const { app } = await createPagesTestApp({
			auth: createSignedInAuth("user_test", workspace.id),
		});
		const requester = createTestRequester(app, {});
		const initialContent = [
			{
				id: "imported-paragraph",
				type: "paragraph",
				props: {},
				content: [{ type: "text", text: "Imported body", styles: {} }],
				children: [],
			},
		];

		const created = await requester.request(createPage, {
			body: {
				workspaceId: workspace.id,
				title: "Imported page",
				initialContent,
			},
			idempotencyKey: "page-import-1",
		});
		const fetched = await requester.request(getPage, {
			path: { id: created.id },
		});

		await app.stop();

		expect(fetched.content).toEqual(initialContent);
		expect(created.contentUpdatedAt).toBe(fetched.contentUpdatedAt);
	});

	it("returns 422 for semantically invalid initial content", async () => {
		const workspace = { id: crypto.randomUUID().replaceAll("-", "") };
		const { app } = await createPagesTestApp({
			auth: createSignedInAuth("user_test", workspace.id),
		});
		const requester = createTestRequester(app, {});

		const result = await requester.safeRequest(createPage, {
			body: {
				workspaceId: workspace.id,
				title: "Invalid import",
				initialContent: [
					{
						id: "invalid-task",
						type: "task",
						props: {
							checked: false,
							due: "tomorrow",
							dueTime: "",
							assignee: "",
						},
						content: [{ type: "text", text: "Invalid task", styles: {} }],
						children: [],
					},
				],
			},
			idempotencyKey: "page-import-invalid",
		});

		await app.stop();

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected an error result.");
		expect(result.status).toBe(422);
		expect(result.error.code).toBe("INVALID_PAGE_CONTENT");
	});

	it("supports the full page lifecycle over HTTP", async () => {
		const workspace = { id: crypto.randomUUID().replaceAll("-", "") };
		const { app } = await createPagesTestApp({
			auth: createSignedInAuth("user_test", workspace.id),
		});
		const requester = createTestRequester(app, {});

		const created = await requester.request(createPage, {
			body: { workspaceId: workspace.id, title: "Weekly notes" },
			idempotencyKey: "page-create-1",
		});
		const child = await requester.request(createPage, {
			body: {
				workspaceId: workspace.id,
				parentPageId: created.id,
				title: "7/2 - Meeting",
			},
			idempotencyKey: "page-create-2",
		});

		const content = [
			{
				id: "block-1",
				type: "heading",
				props: { level: 2 },
				content: [{ type: "text", text: "Agenda", styles: {} }],
				children: [],
			},
		];
		await requester.request(savePageContent, {
			path: { id: created.id },
			body: { content },
		});

		const fetched = await requester.request(getPage, {
			path: { id: created.id },
		});
		const listed = await requester.request(listPages, {
			path: { workspaceId: workspace.id },
		});
		const renamed = await requester.request(updatePage, {
			path: { id: child.id },
			body: { title: "7/2 - Meeting with Josh" },
		});

		expect(fetched.content).toEqual(content);
		expect(listed.items).toHaveLength(2);
		expect(renamed.title).toBe("7/2 - Meeting with Josh");

		await requester.request(deletePage, { path: { id: created.id } });
		const afterDelete = await requester.request(listPages, {
			path: { workspaceId: workspace.id },
		});

		await app.stop();

		expect(afterDelete.items).toEqual([]);
	});

	it("returns 422 for a cyclic move", async () => {
		const workspace = { id: crypto.randomUUID().replaceAll("-", "") };
		const { app } = await createPagesTestApp({
			auth: createSignedInAuth("user_test", workspace.id),
		});
		const requester = createTestRequester(app, {});

		const parent = await requester.request(createPage, {
			body: { workspaceId: workspace.id, title: "Parent" },
			idempotencyKey: "cycle-1",
		});
		const child = await requester.request(createPage, {
			body: {
				workspaceId: workspace.id,
				parentPageId: parent.id,
				title: "Child",
			},
			idempotencyKey: "cycle-2",
		});

		const result = await requester.safeRequest(updatePage, {
			path: { id: parent.id },
			body: { parentPageId: child.id },
		});

		await app.stop();

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected an error result.");
		expect(result.status).toBe(422);
		expect(result.error.code).toBe("INVALID_PAGE_MOVE");
	});
});
