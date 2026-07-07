import { describe, expect, it } from "bun:test";
import {
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/ports/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import type { AppContext } from "@/app-context";
import { enforceUploadRateLimit } from "@/app/api/uploads/[uploadName]/[action]/route";
import { AttachmentUpload } from "@/features/pages/uploads";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";
import { createTestPageRepository } from "./helpers";

function createUploadFixture(role: string) {
	const userId = "user_editor";
	const workspace = {
		id: crypto.randomUUID().replaceAll("-", ""),
		name: "Work",
	};
	const auth = {
		user: {
			id: userId,
			email: `${userId}@example.com`,
			name: "Test User",
			accessStatus: ACCESS_STATUS_APPROVED,
		},
		session: { id: `session_${userId}`, activeOrganizationId: workspace.id },
	};
	const pages = createTestPageRepository();
	const portsFixture = createTestPorts<
		AppContext["ports"],
		AppTransactionPorts
	>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			pages,
		},
		transaction: {
			ports: (ports) => ({ ...ports, pages }),
		},
	});
	const createContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: portsFixture.ports,
		actor: createTestUserActor(auth.user.id, { displayName: auth.user.name }),
		auth,
		tenant: createTestTenant(workspace.id),
		extra: { membership: { role } },
	});

	return { auth, createContext, pages, workspace };
}

function uploadFile() {
	return {
		name: "image.png",
		contentType: "image/png",
		size: 12,
	};
}

async function runAttachmentAuthorization(ctx: AppContext, pageId: string) {
	return AttachmentUpload.authorize?.({
		ctx,
		metadata: { pageId },
		file: uploadFile(),
		uploadId: "upload_test",
	});
}

describe("page attachment uploads", () => {
	it("allows editors to attach files to active pages", async () => {
		const { auth, createContext, pages, workspace } =
			createUploadFixture("owner");
		const page = await pages.create({
			userId: auth.user.id,
			workspaceId: workspace.id,
			parentPageId: null,
			title: "Notes",
			position: 1,
		});

		await expect(
			runAttachmentAuthorization(createContext(), page.id),
		).resolves.toBe(true);
	});

	it("denies viewers attaching files to pages", async () => {
		const { auth, createContext, pages, workspace } =
			createUploadFixture("viewer");
		const page = await pages.create({
			userId: auth.user.id,
			workspaceId: workspace.id,
			parentPageId: null,
			title: "Notes",
			position: 1,
		});

		await expect(
			runAttachmentAuthorization(createContext(), page.id),
		).resolves.toEqual({
			allowed: false,
			reason: "You have view-only access to this workspace.",
		});
	});

	it("denies attaching files to trashed pages", async () => {
		const { auth, createContext, pages, workspace } =
			createUploadFixture("owner");
		const page = await pages.create({
			userId: auth.user.id,
			workspaceId: workspace.id,
			parentPageId: null,
			title: "Notes",
			position: 1,
		});
		await pages.setDeletedByIds([page.id], new Date().toISOString());

		await expect(
			runAttachmentAuthorization(createContext(), page.id),
		).resolves.toBe(false);
	});

	it("returns a 429 response when upload requests exceed the limit", async () => {
		const hits: unknown[] = [];
		const server = {
			ports: {
				rateLimit: {
					async hit(input: unknown) {
						hits.push(input);
						return {
							allowed: false,
							remaining: 0,
							resetAt: null,
							retryAfterSeconds: 42,
						};
					},
				},
			},
		};
		const ctx = {
			auth: {
				user: { id: "user_editor", accessStatus: ACCESS_STATUS_APPROVED },
			},
		} as AppContext;

		const response = await enforceUploadRateLimit(
			server as Parameters<typeof enforceUploadRateLimit>[0],
			new Request("http://test.local/api/uploads/pages.attachment/prepare"),
			ctx,
		);

		expect(hits).toEqual([
			{
				key: "uploads:user:user_editor",
				limit: 120,
				windowSec: 60,
			},
		]);
		expect(response?.status).toBe(429);
		expect(response?.headers.get("retry-after")).toBe("42");
		await expect(response?.json()).resolves.toEqual({
			error: {
				code: "TOO_MANY_REQUESTS",
				message: "Too many upload requests.",
			},
		});
	});

	it("uses client IP when upload requests are unauthenticated", async () => {
		const hits: unknown[] = [];
		const server = {
			ports: {
				rateLimit: {
					async hit(input: unknown) {
						hits.push(input);
						return {
							allowed: true,
							remaining: 119,
							resetAt: null,
							retryAfterSeconds: null,
						};
					},
				},
			},
		};

		const response = await enforceUploadRateLimit(
			server as Parameters<typeof enforceUploadRateLimit>[0],
			new Request("http://test.local/api/uploads/pages.attachment/prepare", {
				headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
			}),
			{ auth: null } as AppContext,
		);

		expect(response).toBeNull();
		expect(hits).toEqual([
			{
				key: "uploads:ip:203.0.113.10",
				limit: 120,
				windowSec: 60,
			},
		]);
	});
});
