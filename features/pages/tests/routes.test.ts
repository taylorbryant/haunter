import { describe, expect, it } from "bun:test";
import { createStaticAuth } from "@beignet/core/ports";
import { createIdempotencyHooks, defineRoutes } from "@beignet/core/server";
import { createTestPorts } from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import { createTestApp, createTestRequester } from "@beignet/web/testing";
import type { AppContext } from "@/app-context";
import { createTestCanvasRepository } from "@/features/canvases/tests/helpers";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import type { AppPorts, AppTransactionPorts } from "@/ports";
import type { AuthRequest, AuthSessionMetadata, AuthUser } from "@/ports/auth";
import { type AppServiceContextInput, appContext } from "@/server/context";
import {
	createPage,
	deletePage,
	getPage,
	listPages,
	savePageContent,
	updatePage,
} from "../contracts";
import { pageRoutes } from "../routes";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
} from "./helpers";

function createSignedInAuth(
	userId: string,
	workspaceId: string,
): AppPorts["auth"] {
	return createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>({
		user: { id: userId, email: `${userId}@example.com`, name: "Test User" },
		// The active organization is the request tenant.
		session: { id: `session_${userId}`, activeOrganizationId: workspaceId },
	});
}

async function createPagesTestApp(options: { auth: AppPorts["auth"] }) {
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository();
	const canvases = createTestCanvasRepository();
	const pageLinks = createTestPageLinkRepository({ pages });
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			pageLinks,
			pages,
			tasks,
			canvases,
			devtools: createInMemoryDevtools(),
			auth: options.auth,
		},
		transaction: {
			ports: (ports) => ({
				...ports,
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
		hooks: [createIdempotencyHooks<AppContext>()],
		routes: defineRoutes<AppContext>([pageRoutes]),
	});

	return { app };
}

describe("pageRoutes", () => {
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
