import { seedFixtureBody } from "@/features/documents/tests/helpers";
import { expect, test } from "bun:test";
import * as Y from "yjs";
import { restorePageVersionUseCase } from "@/features/pages/use-cases/restore-page-version";
import { createPageUseCase } from "@/features/pages/use-cases/create-page";
import { loadPageBody, persistPageBody } from "@/infra/documents/persistence";
import { projectPageBody } from "@/infra/documents/codec";
import { checkDocumentAccess } from "@/infra/documents/access";
import { DocumentRestoredError } from "../restoration";
import { documentFixture, firstText, paragraph } from "./helpers";

async function version(
	f: Awaited<ReturnType<typeof documentFixture>>,
	content = [paragraph("Earlier body")],
) {
	return f.database.repositories.pageVersions.create(f.scope, {
		pageId: f.page.id,
		title: "Earlier title",
		icon: null,
		contentJson: JSON.stringify(content),
		cause: "checkpoint",
		createdBy: f.userId,
	});
}

test("restore snapshots the prior body, rebuilds derivations, and fences old writes and grants", async () => {
	const f = await documentFixture();
	const doc = new Y.Doc();
	try {
		const target = await createPageUseCase.run({
			ctx: f.ctx,
			input: { workspaceId: f.workspaceId, title: "Target" },
		});
		const oldContent = [
			paragraph("Earlier body"),
			{
				id: "old-task",
				type: "task",
				props: { checked: true, dueDate: "2026-09-10" },
				content: [{ type: "text", text: "Restored task", styles: {} }],
				children: [],
			},
			{
				id: "old-link",
				type: "pageLink",
				props: { pageId: target.id, workspaceId: f.workspaceId },
				children: [],
			},
		];
		const checkpoint = await version(f, oldContent as never);
		await seedFixtureBody(
			f,
			JSON.parse(JSON.stringify([paragraph("Current body")])),
		);
		Y.applyUpdate(
			doc,
			(await loadPageBody(f.ctx, f.workspaceId, f.page.id)).state,
		);
		firstText(doc).insert(0, "Unsent offline edit ");
		const result = await restorePageVersionUseCase.run({
			ctx: f.ctx,
			input: { id: f.page.id, versionId: checkpoint.id },
		});
		expect(result.documentGeneration).toBe(1);
		expect(result.tasksChanged).toBe(true);
		expect(result.linksChanged).toBe(true);
		const page = await f.database.repositories.pages.findById(
			f.scope,
			f.page.id,
		);
		expect(JSON.stringify(page?.content)).toContain("Earlier body");
		expect(page?.title).toBe("Document");
		expect(
			await f.database.repositories.pages.searchByWorkspace(
				f.scope,
				"Earlier body",
				10,
			),
		).toHaveLength(1);
		expect(
			await f.database.repositories.pageLinks.listBacklinkSources(
				f.scope,
				target.id,
			),
		).toHaveLength(1);
		const versions = await f.database.repositories.pageVersions.listMetaByPage(
			f.scope,
			f.page.id,
		);
		const before = versions.find((item) => item.cause === "restore");
		expect(
			JSON.stringify(
				(
					await f.database.repositories.pageVersions.findById(
						f.scope,
						before!.id,
					)
				)?.content,
			),
		).toContain("Current body");
		await expect(
			persistPageBody(f.ctx, {
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				doc,
				generation: 0,
				baseRevision: 0,
			}),
		).rejects.toBeInstanceOf(DocumentRestoredError);
		await expect(
			checkDocumentAccess(f.grant, f.database.db),
		).rejects.toBeInstanceOf(DocumentRestoredError);
		expect(
			await checkDocumentAccess({ ...f.grant, generation: 1 }, f.database.db),
		).toBe("owner");
		const restored = new Y.Doc();
		Y.applyUpdate(
			restored,
			(await loadPageBody(f.ctx, f.workspaceId, f.page.id)).state,
		);
		expect(JSON.stringify(projectPageBody(restored))).not.toContain(
			"Unsent offline edit",
		);
		firstText(restored).insert(0, "Fresh edit ");
		await persistPageBody(f.ctx, {
			workspaceId: f.workspaceId,
			pageId: f.page.id,
			doc: restored,
			generation: 1,
			baseRevision: 1,
		});
		const again = await restorePageVersionUseCase.run({
			ctx: f.ctx,
			input: { id: f.page.id, versionId: before!.id },
		});
		expect(again.documentGeneration).toBe(2);
		expect(
			JSON.stringify(
				(await f.database.repositories.pages.findById(f.scope, f.page.id))
					?.content,
			),
		).toContain("Current body");
		expect(
			await f.database.repositories.pageLinks.listBacklinkSources(
				f.scope,
				target.id,
			),
		).toHaveLength(0);
		restored.destroy();
	} finally {
		doc.destroy();
		await f.database.close();
	}
});

test("invalid history content rolls back the checkpoint and document reset", async () => {
	const f = await documentFixture();
	try {
		const checkpoint = await version(f, [
			{ ...paragraph("bad"), type: "unsupported-type" },
		]);
		const before = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		const count = (
			await f.database.repositories.pageVersions.listMetaByPage(
				f.scope,
				f.page.id,
			)
		).length;
		await expect(
			restorePageVersionUseCase.run({
				ctx: f.ctx,
				input: { id: f.page.id, versionId: checkpoint.id },
			}),
		).rejects.toThrow();
		expect(
			await f.database.repositories.documents.find(f.scope, f.page.id),
		).toEqual(before);
		expect(
			await f.database.repositories.pageVersions.listMetaByPage(
				f.scope,
				f.page.id,
			),
		).toHaveLength(count);
	} finally {
		await f.database.close();
	}
});

test("a viewer cannot reset a collaborative document", async () => {
	const f = await documentFixture("viewer");
	try {
		const checkpoint = await version(f);
		const before = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		await expect(
			restorePageVersionUseCase.run({
				ctx: f.ctx,
				input: { id: f.page.id, versionId: checkpoint.id },
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(
			await f.database.repositories.documents.find(f.scope, f.page.id),
		).toEqual(before);
	} finally {
		await f.database.close();
	}
});

test("a version belonging to another page cannot be restored into the current page", async () => {
	const f = await documentFixture();
	try {
		const other = await createPageUseCase.run({
			ctx: f.ctx,
			input: { workspaceId: f.workspaceId, title: "Other page" },
		});
		const wrongVersion = await f.database.repositories.pageVersions.create(
			f.scope,
			{
				pageId: other.id,
				title: "Other",
				icon: null,
				contentJson: JSON.stringify([paragraph("Other content")]),
				createdBy: f.userId,
				cause: "checkpoint",
			},
		);
		const before = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		await expect(
			restorePageVersionUseCase.run({
				ctx: f.ctx,
				input: { id: f.page.id, versionId: wrongVersion.id },
			}),
		).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
		expect(
			await f.database.repositories.documents.find(f.scope, f.page.id),
		).toEqual(before);
		expect(
			await f.database.repositories.pageVersions.listMetaByPage(
				f.scope,
				f.page.id,
			),
		).toHaveLength(0);
	} finally {
		await f.database.close();
	}
});
