import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import {
	createTestAnonymousActor,
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/ports/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import type { PageRepository } from "@/features/pages/ports";
import { createTestPageRepository } from "@/features/pages/tests/helpers";
import type { ShareRepository } from "@/features/shares/ports";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import {
	createPageShareUseCase,
	getPageShareUseCase,
	getSharedPageUseCase,
	revokePageShareUseCase,
} from "../use-cases";
import { createTestShareRepository } from "./helpers";

function createTester(options: {
	pages: PageRepository;
	shares: ShareRepository;
	workspaceId: string | null;
	userId?: string | null;
	role?: string;
}) {
	const { pages, shares, workspaceId } = options;
	const userId = options.userId === undefined ? "user_test" : options.userId;
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			pages,
			shares,
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({ ...ports, pages, shares }),
		},
	});
	const createTestContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: fixture.ports,
		actor: userId
			? createTestUserActor(userId, { displayName: "Test User" })
			: createTestAnonymousActor(),
		auth: userId
			? {
					user: { id: userId, email: `${userId}@example.com`, name: "Test" },
					session: {
						id: `session_${userId}`,
						activeOrganizationId: workspaceId ?? undefined,
					},
				}
			: null,
		tenant: workspaceId ? createTestTenant(workspaceId) : null,
		extra: userId ? { membership: { role: options.role ?? "owner" } } : {},
	});

	return createUseCaseTester<AppContext>(createTestContext);
}

async function createFixture(role = "owner") {
	const pages = createTestPageRepository();
	const shares = createTestShareRepository();
	// Better Auth org ids are nanoid-style, not UUIDs.
	const workspaceId = crypto.randomUUID().replaceAll("-", "");
	const page = await pages.create({
		userId: "user_test",
		workspaceId,
		parentPageId: null,
		title: "Public notes",
		position: 1,
	});
	await pages.saveContent(
		page.id,
		JSON.stringify([
			{
				id: "b1",
				type: "paragraph",
				props: {},
				content: [{ type: "text", text: "Hello, web", styles: {} }],
				children: [],
			},
		]),
	);
	const tester = createTester({ pages, shares, workspaceId, role });
	const ctx = await tester.ctx();
	// A visitor with no session, tenant, or membership.
	const anonymous = createTester({
		pages,
		shares,
		workspaceId: null,
		userId: null,
	});
	const anonymousCtx = await anonymous.ctx();

	return {
		pages,
		shares,
		workspaceId,
		page,
		tester,
		ctx,
		anonymous,
		anonymousCtx,
	};
}

describe("page shares", () => {
	it("publishes a page and returns a stable link on re-publish", async () => {
		const { page, tester, ctx } = await createFixture();

		const share = await tester.run(
			createPageShareUseCase,
			{ pageId: page.id },
			{ ctx },
		);
		expect(share.token.length).toBeGreaterThanOrEqual(32);

		const again = await tester.run(
			createPageShareUseCase,
			{ pageId: page.id },
			{ ctx },
		);
		expect(again.token).toBe(share.token);

		const status = await tester.run(
			getPageShareUseCase,
			{ pageId: page.id },
			{ ctx },
		);
		expect(status.share?.token).toBe(share.token);
	});

	it("serves the shared page to anonymous visitors by token only", async () => {
		const { page, tester, ctx, anonymous, anonymousCtx } =
			await createFixture();

		const share = await tester.run(
			createPageShareUseCase,
			{ pageId: page.id },
			{ ctx },
		);

		const shared = await anonymous.run(
			getSharedPageUseCase,
			{ token: share.token },
			{ ctx: anonymousCtx },
		);
		expect(shared.title).toBe("Public notes");
		expect(shared.content[0]?.id).toBe("b1");

		await expect(
			anonymous.run(
				getSharedPageUseCase,
				{ token: "not-a-real-token" },
				{ ctx: anonymousCtx },
			),
		).rejects.toThrow(/no longer available/);
	});

	it("revoking the link kills anonymous access", async () => {
		const { page, tester, ctx, anonymous, anonymousCtx } =
			await createFixture();

		const share = await tester.run(
			createPageShareUseCase,
			{ pageId: page.id },
			{ ctx },
		);
		await tester.run(revokePageShareUseCase, { pageId: page.id }, { ctx });

		await expect(
			anonymous.run(
				getSharedPageUseCase,
				{ token: share.token },
				{ ctx: anonymousCtx },
			),
		).rejects.toThrow(/no longer available/);
	});

	it("a trashed page reads as gone even with a live token", async () => {
		const { pages, page, tester, ctx, anonymous, anonymousCtx } =
			await createFixture();

		const share = await tester.run(
			createPageShareUseCase,
			{ pageId: page.id },
			{ ctx },
		);
		await pages.setDeletedByIds([page.id], new Date().toISOString());

		await expect(
			anonymous.run(
				getSharedPageUseCase,
				{ token: share.token },
				{ ctx: anonymousCtx },
			),
		).rejects.toThrow(/no longer available/);
	});

	it("viewers cannot publish or revoke", async () => {
		const { page, tester, ctx } = await createFixture("viewer");

		await expect(
			tester.run(createPageShareUseCase, { pageId: page.id }, { ctx }),
		).rejects.toThrow("view-only");
		await expect(
			tester.run(revokePageShareUseCase, { pageId: page.id }, { ctx }),
		).rejects.toThrow("view-only");
	});

	it("members of another workspace cannot publish someone else's page", async () => {
		const { pages, shares, page } = await createFixture();

		const outsider = createTester({
			pages,
			shares,
			workspaceId: crypto.randomUUID().replaceAll("-", ""),
			userId: "user_outsider",
		});
		const outsiderCtx = await outsider.ctx();

		await expect(
			outsider.run(
				createPageShareUseCase,
				{ pageId: page.id },
				{ ctx: outsiderCtx },
			),
		).rejects.toThrow("You do not have access to this page.");
	});
});
