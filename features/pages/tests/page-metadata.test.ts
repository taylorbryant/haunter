import { seedFixtureBody } from "@/features/documents/tests/helpers";
import { expect, test, spyOn } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createTenantScope } from "@beignet/core/ports";
import { documentFixture, paragraph } from "@/features/documents/tests/helpers";
import { getPageMetadataUseCase } from "../use-cases/get-page-metadata";
import { getPageUseCase } from "../use-cases/get-page";
import {
	getPageMetadataQueryOptions,
	getPageQueryOptions,
	invalidatePage,
	optimisticallySetPageTitle,
	restorePageTitleInCache,
	setPageIconInCache,
	setPageTitleInCache,
} from "../client/queries";
import type { PageMeta } from "../schemas";
import * as schema from "@/infra/db/schema";

test("metadata reads never fetch the body, while full reads still provide it", async () => {
	const f = await documentFixture("viewer");
	const blocks = [paragraph("Body used by exports")];
	try {
		await seedFixtureBody(f, JSON.parse(JSON.stringify(blocks)));
		const bodyRead = spyOn(f.ctx.ports.pages, "findById");
		try {
			const metadata = await getPageMetadataUseCase.run({
				ctx: f.ctx,
				input: { id: f.page.id },
			});
			expect(metadata.title).toBe(f.page.title);
			expect(metadata).not.toHaveProperty("content");
			expect(bodyRead).not.toHaveBeenCalled();
			const full = await getPageUseCase.run({
				ctx: f.ctx,
				input: { id: f.page.id },
			});
			expect(full.content).toMatchObject(blocks);
		} finally {
			bodyRead.mockRestore();
		}
	} finally {
		await f.database.close();
	}
});

test("metadata reads retain tenant and trash boundaries", async () => {
	const f = await documentFixture();
	try {
		await f.database.db.insert(schema.organization).values({
			id: "foreign-workspace",
			name: "Foreign",
			slug: "foreign",
			createdAt: new Date(),
		});
		const foreign = await f.database.repositories.pages.create(
			createTenantScope({ id: "foreign-workspace" }),
			{
				userId: f.userId,
				title: "Foreign page",
				parentPageId: null,
				position: 0,
			},
		);
		await expect(
			getPageMetadataUseCase.run({ ctx: f.ctx, input: { id: foreign.id } }),
		).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
		await f.database.repositories.pages.setDeletedByIds(
			f.scope,
			[f.page.id],
			new Date().toISOString(),
		);
		await expect(
			getPageMetadataUseCase.run({ ctx: f.ctx, input: { id: f.page.id } }),
		).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
	} finally {
		await f.database.close();
	}
});

test("title/icon changes and invalidation reach both caches without inventing body data", async () => {
	const f = await documentFixture();
	const client = new QueryClient();
	try {
		const meta = await f.database.repositories.pages.findMetaById(
			f.scope,
			f.page.id,
		);
		const fullKey = getPageQueryOptions(f.page.id).queryKey;
		const metaKey = getPageMetadataQueryOptions(f.page.id).queryKey;
		client.setQueryData(fullKey, {
			...f.page,
			content: [paragraph("Preserve this body")],
		});
		client.setQueryData(metaKey, meta);
		setPageIconInCache(client, f.page.id, "📝");
		setPageTitleInCache(client, f.page.id, "Renamed");
		expect(client.getQueryData(metaKey)).toMatchObject({
			title: "Renamed",
			icon: "📝",
		});
		expect(client.getQueryData(metaKey)).not.toHaveProperty("content");
		expect(JSON.stringify(client.getQueryData(fullKey))).toContain(
			"Preserve this body",
		);
		await invalidatePage(client, f.page.id);
		expect(client.getQueryState(metaKey)?.isInvalidated).toBe(true);
		expect(client.getQueryState(fullKey)?.isInvalidated).toBe(true);
	} finally {
		client.clear();
		await f.database.close();
	}
});

test("a stale metadata response cannot overwrite an optimistic rename or its rollback", async () => {
	const f = await documentFixture();
	const client = new QueryClient();
	try {
		const meta = await f.database.repositories.pages.findMetaById(
			f.scope,
			f.page.id,
		);
		if (!meta) throw new Error("Missing fixture page");
		const queryKey = getPageMetadataQueryOptions(f.page.id).queryKey;
		client.setQueryData(queryKey, meta);
		let complete: (value: PageMeta) => void = () => {};
		const pending = client
			.fetchQuery({
				queryKey,
				staleTime: 0,
				queryFn: () =>
					new Promise<PageMeta>((resolve) => {
						complete = resolve;
					}),
			})
			.catch(() => undefined);
		const old = await optimisticallySetPageTitle(
			client,
			f.workspaceId,
			f.page.id,
			"Optimistic",
			{ previousTitle: meta.title, previousUpdatedAt: meta.updatedAt },
		);
		complete({ ...meta, title: "Stale response" });
		await pending;
		expect(client.getQueryData<PageMeta>(queryKey)?.title).toBe("Optimistic");
		restorePageTitleInCache(
			client,
			f.page.id,
			"Optimistic",
			old.previousTitle,
			old.previousUpdatedAt,
		);
		expect(client.getQueryData<PageMeta>(queryKey)?.title).toBe(meta.title);
	} finally {
		client.clear();
		await f.database.close();
	}
});
