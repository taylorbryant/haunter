import { createTenantScope } from "@beignet/core/ports";
import { z } from "zod";
import type { BlockJson } from "@/features/pages/schemas";
import { defineTask } from "@/lib/tasks";
import { ensureCollaborativeDocument } from "../service";

const BackfillDocumentsInputSchema = z.object({
	dryRun: z.boolean().default(true),
	replaceExisting: z.literal("replace-liveblocks-from-sqlite").optional(),
	limit: z.number().int().min(1).max(10_000).default(500),
	afterPageId: z.string().uuid().optional(),
});

function canvasIdsIn(content: BlockJson[]): string[] {
	const ids = new Set<string>();
	const visit = (blocks: BlockJson[]) => {
		for (const block of blocks) {
			if (block.type === "canvas") {
				const id = block.props.canvasId;
				if (typeof id === "string" && id.length > 0) ids.add(id);
			}
			visit(block.children);
		}
	};
	visit(content);
	return [...ids];
}

export const BackfillDocumentsTask = defineTask("documents.backfill", {
	input: BackfillDocumentsInputSchema,
	description:
		"Seed provider-neutral v2 Yjs documents from a workspace's SQLite projections.",
	async handle({ input, ctx }) {
		if (!ctx.tenant) {
			throw new Error("Pass --tenant <workspace-id> to backfill documents.");
		}
		const scope = createTenantScope(ctx.tenant);
		const refreshFromProjection =
			input.replaceExisting === "replace-liveblocks-from-sqlite";
		const pages = await ctx.ports.pages.listMetaByWorkspace(scope);
		const cursorIndex = input.afterPageId
			? pages.findIndex((page) => page.id === input.afterPageId)
			: -1;
		if (input.afterPageId && cursorIndex < 0) {
			throw new Error(
				`Backfill cursor ${input.afterPageId} does not belong to this workspace.`,
			);
		}
		const start = cursorIndex + 1;
		const batch = pages.slice(start, start + input.limit);
		let pagesSeeded = 0;
		let pagesRefreshed = 0;
		let canvasesSeeded = 0;
		let canvasesRefreshed = 0;
		for (const pageMeta of batch) {
			const page = await ctx.ports.pages.findById(scope, pageMeta.id);
			if (!page) continue;
			if (!input.dryRun) {
				const result = await ensureCollaborativeDocument({
					scope,
					kind: "page",
					entityId: page.id,
					ports: ctx.ports,
					refreshFromProjection,
				});
				if (result.seeded) pagesSeeded += 1;
				if (result.refreshed) pagesRefreshed += 1;
			}
			for (const canvasId of canvasIdsIn(page.content)) {
				const canvas = await ctx.ports.canvases.findById(scope, canvasId);
				if (!canvas) continue;
				if (!input.dryRun) {
					const result = await ensureCollaborativeDocument({
						scope,
						kind: "canvas",
						entityId: canvas.id,
						ports: ctx.ports,
						refreshFromProjection,
					});
					if (result.seeded) canvasesSeeded += 1;
					if (result.refreshed) canvasesRefreshed += 1;
				}
			}
		}
		const last = batch.at(-1);
		return {
			dryRun: input.dryRun,
			pagesScanned: batch.length,
			pagesSeeded,
			pagesRefreshed,
			canvasesSeeded,
			canvasesRefreshed,
			nextCursor: last && start + batch.length < pages.length ? last.id : null,
		};
	},
});
