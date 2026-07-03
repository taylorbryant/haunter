import { describe, expect, it } from "bun:test";
import { createStaticAuth } from "@beignet/core/ports";
import { createIdempotencyHooks, defineRoutes } from "@beignet/core/server";
import { createTestPorts } from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import { createTestApp, createTestRequester } from "@beignet/web/testing";
import type { AppContext } from "@/app-context";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
} from "@/features/pages/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import type { AppPorts, AppTransactionPorts } from "@/ports";
import type { AuthRequest, AuthSessionMetadata, AuthUser } from "@/ports/auth";
import { type AppServiceContextInput, appContext } from "@/server/context";
import {
	createWorkspace,
	deleteWorkspace,
	listWorkspaces,
	updateWorkspace,
} from "../contracts";
import { workspaceRoutes } from "../routes";
import { createTestWorkspaceRepository } from "./helpers";

function createSignedInAuth(userId: string): AppPorts["auth"] {
	return createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>({
		user: { id: userId, email: `${userId}@example.com`, name: "Test User" },
		session: { id: `session_${userId}` },
	});
}

function createSignedOutAuth(): AppPorts["auth"] {
	return createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>(null);
}

async function createWorkspacesTestApp(
	options: { auth?: AppPorts["auth"] } = {},
) {
	const workspaces = createTestWorkspaceRepository();
	const pages = createTestPageRepository();
	const pageLinks = createTestPageLinkRepository({ pages });
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			workspaces,
			pageLinks,
			pages,
			devtools: createInMemoryDevtools(),
			auth: options.auth ?? createSignedOutAuth(),
		},
		transaction: {
			ports: (ports) => ({
				...ports,
				workspaces,
				pageLinks,
				pages,
			}),
		},
	});

	return createTestApp<AppContext, AppContext["ports"], AppServiceContextInput>(
		{
			ports: fixture.ports,
			context: appContext,
			hooks: [createIdempotencyHooks<AppContext>()],
			routes: defineRoutes<AppContext>([workspaceRoutes]),
		},
	);
}

describe("workspaceRoutes", () => {
	it("requires a signed-in user", async () => {
		const app = await createWorkspacesTestApp();
		const requester = createTestRequester(app, {});

		const result = await requester.safeRequest(listWorkspaces);

		await app.stop();

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected an error result.");
		expect(result.status).toBe(401);
		expect(result.error.code).toBe("UNAUTHORIZED");
	});

	it("creates, updates, lists, and deletes workspaces", async () => {
		const app = await createWorkspacesTestApp({
			auth: createSignedInAuth("user_test"),
		});
		const requester = createTestRequester(app, {});

		const created = await requester.request(createWorkspace, {
			body: { name: "Work" },
			idempotencyKey: "workspace-create-1",
		});
		const replayed = await requester.request(createWorkspace, {
			body: { name: "Work" },
			idempotencyKey: "workspace-create-1",
		});
		const updated = await requester.request(updateWorkspace, {
			path: { id: created.id },
			body: { name: "Job", icon: "💼" },
		});
		const listed = await requester.request(listWorkspaces);

		expect(replayed.id).toBe(created.id);
		expect(updated.name).toBe("Job");
		expect(listed.items).toEqual([updated]);

		await requester.request(deleteWorkspace, { path: { id: created.id } });
		const afterDelete = await requester.request(listWorkspaces);

		await app.stop();

		expect(afterDelete.items).toEqual([]);
	});
});
