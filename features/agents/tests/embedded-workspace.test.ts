import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { embeddedEditorFixture } from "./embedded-editor-fixture";
import {
	getEmbeddedWorkspaceUseCase,
	actInEmbeddedWorkspaceUseCase,
} from "../use-cases/embedded-workspace";
import type { WorkspaceAction } from "../mcp-app/workspace-schema";

test("embedded workspace creation, favorites, hierarchy and reversible archive reuse the web records", async () => {
	const f = await embeddedEditorFixture();
	const input = { workspaceId: f.workspaceId, clientId: "embedded-client" };
	const act = (operation: WorkspaceAction) =>
		actInEmbeddedWorkspaceUseCase.run({
			ctx: f.ctx,
			input: { ...input, operation },
		});
	const read = () => getEmbeddedWorkspaceUseCase.run({ ctx: f.ctx, input });
	try {
		const child = await act({
			action: "create-page",
			parentPageId: f.page.id,
			title: "Embedded child",
			atCursor: true,
		});
		const canvas = await act({
			action: "create-canvas",
			title: "Standalone drawing",
		});
		await act({ action: "favorite-page", pageId: child.id, favorite: true });
		await act({
			action: "favorite-canvas",
			canvasId: canvas.id,
			favorite: true,
		});
		const state = await read();
		expect(state.canEdit).toBeTrue();
		expect(state.favorites).toContain(child.id);
		expect(state.canvasFavorites).toContain(canvas.id);
		expect(state.pages.find((p) => p.pageId === child.id)?.parentPageId).toBe(
			f.page.id,
		);
		expect(state.canvases.find((c) => c.id === canvas.id)?.title).toBe(
			"Standalone drawing",
		);
		await expect(
			act({ action: "move-page", pageId: f.page.id, parentPageId: child.id }),
		).rejects.toThrow();
		await act({ action: "move-page", pageId: child.id, parentPageId: null });
		expect(
			(await read()).pages.find((p) => p.pageId === child.id)?.parentPageId,
		).toBeNull();
		await act({ action: "archive-page", pageId: child.id });
		expect((await read()).pages.some((p) => p.pageId === child.id)).toBeFalse();
		await act({ action: "restore-page", pageId: child.id });
		expect((await read()).pages.some((p) => p.pageId === child.id)).toBeTrue();
	} finally {
		await f.database.close();
	}
});

test.each([
	["view", "edit"],
	["edit", "view"],
] as const)(
	"embedded workspace mutations require both embedded consent (%s) and edit profile (%s)",
	async (access, profile) => {
		const f = await embeddedEditorFixture(access, profile);
		const input = { workspaceId: f.workspaceId, clientId: "embedded-client" };
		try {
			expect(
				(await getEmbeddedWorkspaceUseCase.run({ ctx: f.ctx, input })).canEdit,
			).toBeFalse();
			await expect(
				actInEmbeddedWorkspaceUseCase.run({
					ctx: f.ctx,
					input: {
						...input,
						operation: { action: "create-page", title: "Blocked" },
					},
				}),
			).rejects.toThrow();
		} finally {
			await f.database.close();
		}
	},
);

test("workspace UI rechecks membership, scope and OAuth consent on every action", async () => {
	const f = await embeddedEditorFixture();
	const input = { workspaceId: f.workspaceId, clientId: "embedded-client" };
	const read = () => getEmbeddedWorkspaceUseCase.run({ ctx: f.ctx, input });
	const act = () =>
		actInEmbeddedWorkspaceUseCase.run({
			ctx: f.ctx,
			input: {
				...input,
				operation: {
					action: "favorite-page",
					pageId: f.page.id,
					favorite: true,
				},
			},
		});
	try {
		await expect(
			getEmbeddedWorkspaceUseCase.run({
				ctx: f.ctx,
				input: { ...input, workspaceId: "unapproved" },
			}),
		).rejects.toThrow();
		await f.database.db
			.update(schema.member)
			.set({ role: "viewer" })
			.where(eq(schema.member.id, "document-member"));
		expect((await read()).canEdit).toBeFalse();
		await expect(act()).rejects.toThrow();
		await f.database.db
			.update(schema.member)
			.set({ role: "owner" })
			.where(eq(schema.member.id, "document-member"));
		await act();
		await f.database.db.delete(schema.oauthConsent);
		await expect(read()).rejects.toThrow();
		await expect(act()).rejects.toThrow();
	} finally {
		await f.database.close();
	}
});
