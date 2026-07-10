import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTenantScope } from "@beignet/core/ports";
import {
	createTestAnonymousActor,
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import type { CanvasRepository } from "@/features/canvases/ports";
import { createTestCanvasRepository } from "@/features/canvases/tests/helpers";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import type { PageRepository } from "@/features/pages/ports";
import { createTestPageRepository } from "@/features/pages/tests/helpers";
import { contentReferencesFileKey } from "@/features/shares/lib/file-keys";
import { sharedFileHeaders } from "@/features/shares/lib/shared-file-response";
import {
	enforceSharedFileRateLimit,
	enforceSharedFileTokenRateLimit,
} from "@/features/shares/lib/shared-file-rate-limit";
import type { ShareRepository } from "@/features/shares/ports";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";
import {
	createPageShareUseCase,
	getPageShareUseCase,
	getSharedCanvasUseCase,
	getSharedPageUseCase,
	revokePageShareUseCase,
} from "../use-cases";
import { createTestShareRepository } from "./helpers";

function createTester(options: {
	pages: PageRepository;
	shares: ShareRepository;
	canvases?: CanvasRepository;
	workspaceId: string | null;
	userId?: string | null;
	role?: string;
}) {
	const { pages, shares, workspaceId } = options;
	const canvases = options.canvases ?? createTestCanvasRepository();
	const userId = options.userId === undefined ? "user_test" : options.userId;
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			canvases,
			pages,
			shares,
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({ ...ports, canvases, pages, shares }),
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
					user: {
						id: userId,
						email: `${userId}@example.com`,
						name: "Test",
						accessStatus: ACCESS_STATUS_APPROVED,
					},
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
	const canvases = createTestCanvasRepository();
	// Better Auth org ids are nanoid-style, not UUIDs.
	const workspaceId = crypto.randomUUID().replaceAll("-", "");
	const scope = createTenantScope(createTestTenant(workspaceId));
	const page = await pages.create(scope, {
		userId: "user_test",
		parentPageId: null,
		title: "Public notes",
		position: 1,
	});
	const content = [
		{
			id: "b1",
			type: "paragraph",
			props: {},
			content: [{ type: "text", text: "Hello, web", styles: {} }],
			children: [],
		},
	];
	await pages.saveContent(
		scope,
		page.id,
		JSON.stringify(content),
		extractPageSearchText(content),
	);
	const tester = createTester({ pages, shares, canvases, workspaceId, role });
	const ctx = await tester.ctx();
	// A visitor with no session, tenant, or membership.
	const anonymous = createTester({
		pages,
		shares,
		canvases,
		workspaceId: null,
		userId: null,
	});
	const anonymousCtx = await anonymous.ctx();

	return {
		pages,
		shares,
		canvases,
		workspaceId,
		scope,
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
		const { pages, scope, page, tester, ctx, anonymous, anonymousCtx } =
			await createFixture();

		const share = await tester.run(
			createPageShareUseCase,
			{ pageId: page.id },
			{ ctx },
		);
		await pages.setDeletedByIds(scope, [page.id], new Date().toISOString());

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

	it("rewrites embedded file URLs to the share-scoped route", async () => {
		const { pages, scope, page, tester, ctx, anonymous, anonymousCtx } =
			await createFixture();
		const key = `pages/ws/${page.id}/img.png`;

		const content = [
			{
				id: "img-1",
				type: "image",
				props: { url: `/api/files/${key}` },
				children: [],
			},
		];
		await pages.saveContent(
			scope,
			page.id,
			JSON.stringify(content),
			extractPageSearchText(content),
		);

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

		expect(shared.content[0]?.props.url).toBe(
			`/api/shared/${share.token}/files/${key}`,
		);
		expect(contentReferencesFileKey(shared.content, key)).toBe(true);
		expect(contentReferencesFileKey(shared.content, `${key}.removed`)).toBe(
			false,
		);
	});

	it("serves canvases on the shared page and refuses others", async () => {
		const {
			pages,
			canvases,
			scope,
			page,
			tester,
			ctx,
			anonymous,
			anonymousCtx,
		} = await createFixture();

		const onSharedPage = await canvases.create(scope, {
			userId: "user_test",
			pageId: page.id,
		});
		await canvases.saveSnapshot(
			scope,
			onSharedPage.id,
			JSON.stringify({ store: { shape: 1 } }),
		);
		const otherPage = await pages.create(scope, {
			userId: "user_test",
			parentPageId: null,
			title: "Not shared",
			position: 2,
		});
		const elsewhere = await canvases.create(scope, {
			userId: "user_test",
			pageId: otherPage.id,
		});

		const share = await tester.run(
			createPageShareUseCase,
			{ pageId: page.id },
			{ ctx },
		);

		const served = await anonymous.run(
			getSharedCanvasUseCase,
			{ token: share.token, id: onSharedPage.id },
			{ ctx: anonymousCtx },
		);
		expect(served.snapshot).toEqual({ store: { shape: 1 } });

		// Same workspace, different page: the token must not reach it.
		await expect(
			anonymous.run(
				getSharedCanvasUseCase,
				{ token: share.token, id: elsewhere.id },
				{ ctx: anonymousCtx },
			),
		).rejects.toThrow(/no longer available/);
	});

	it("treats another workspace's page as not found", async () => {
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
		).rejects.toThrow("Page not found");
	});
});

describe("shared file route helpers", () => {
	it("finds only file keys still referenced by the page content", () => {
		const key = "pages/workspace/page/file.png";
		const content = [
			{
				id: "outer",
				type: "paragraph",
				props: {},
				children: [
					{
						id: "image",
						type: "image",
						props: { url: `/api/files/${key}` },
						children: [],
					},
				],
			},
		];

		expect(contentReferencesFileKey(content, key)).toBe(true);
		expect(
			contentReferencesFileKey(content, "pages/workspace/page/old.png"),
		).toBe(false);
	});

	it("rate-limits shared file reads by IP before share lookup", async () => {
		const hits: unknown[] = [];
		const server = {
			ports: {
				rateLimit: {
					async hit(input: unknown) {
						hits.push(input);
						return {
							allowed: true,
							remaining: 1,
							resetAt: null,
							retryAfterSeconds: null,
						};
					},
				},
			},
		};

		await expect(
			enforceSharedFileRateLimit(
				server,
				new Request("https://example.test/file", {
					headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
				}),
			),
		).resolves.toBeNull();

		expect(hits).toEqual([
			{
				key: "share-files:ip:203.0.113.5",
				limit: 300,
				windowSec: 60,
			},
		]);

		await expect(
			enforceSharedFileTokenRateLimit(server, "token_1"),
		).resolves.toBeNull();
		expect(hits).toEqual([
			{
				key: "share-files:ip:203.0.113.5",
				limit: 300,
				windowSec: 60,
			},
			{
				key: "share-files:token:token_1",
				limit: 300,
				windowSec: 60,
			},
		]);
	});

	it("does not spend token buckets once the shared file IP bucket is exhausted", async () => {
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
							retryAfterSeconds: 12,
						};
					},
				},
			},
		};

		const response = await enforceSharedFileRateLimit(
			server,
			new Request("https://example.test/file"),
		);

		expect(response?.status).toBe(429);
		expect(response?.headers.get("retry-after")).toBe("12");
		expect(hits).toEqual([
			{
				key: "share-files:ip:unknown",
				limit: 300,
				windowSec: 60,
			},
		]);
	});

	it("does not reuse immutable upload cache headers for shared files", () => {
		const headers = new Headers(
			sharedFileHeaders({
				contentType: "image/png",
				size: 12,
			}),
		);

		expect(headers.get("content-type")).toBe("image/png");
		expect(headers.get("content-length")).toBe("12");
		expect(headers.get("cache-control")).toBe("no-store");
	});
});
