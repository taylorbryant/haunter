import "@beignet/core/server-only";
import {
	scheduleWorkspacePageEvent,
	scheduleWorkspaceCanvasEvent,
} from "@/features/collab/server/workspace-events";
import type { BlockJson } from "@/features/content/schemas";
import type { PageMeta } from "@/features/pages/schemas";
import { reconcilePageDerivations } from "@/features/pages/lib/apply-page-content";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	ImportRecoveryInputSchema,
	ImportRecoveryOutputSchema,
	parseRecoveryFile,
} from "../recovery";

export const importRecoveryUseCase = useCase
	.command("documents.importRecovery")
	.input(ImportRecoveryInputSchema)
	.output(ImportRecoveryOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);
		await ctx.gate.authorize("pages.create");
		let bundle: ReturnType<typeof parseRecoveryFile>;
		try {
			bundle = parseRecoveryFile(input.file, input.filename);
		} catch (error) {
			throw appError("InvalidPageContent", {
				message:
					error instanceof Error ? error.message : "Invalid recovery file",
			});
		}
		if (bundle.canvases.length) await ctx.gate.authorize("canvases.create");
		// Validate every body before opening the write transaction. No partial imports.
		const recovered: ((typeof bundle.pages)[number] & {
			content: BlockJson[];
		})[] = [];
		for (const page of bundle.pages) {
			const content = page.collaborativeState
				? await ctx.ports.documentRecovery.decode(
						page.collaborativeState.update,
					)
				: await ctx.ports.documentRecovery.normalize(page.content);
			recovered.push({ ...page, content });
		}
		const recoveredCanvases = await Promise.all(
			bundle.canvases.map(async (canvas) => ({
				...canvas,
				snapshot: canvas.collaborativeState
					? await ctx.ports.documentRecovery.decodeCanvas(
							canvas.collaborativeState.update,
						)
					: (canvas.snapshot ?? {}),
			})),
		);
		const result = await ctx.ports.uow.transaction(async (tx) => {
			const pages: PageMeta[] = [];
			let position = await tx.pages.maxPositionForParent(scope, null);
			for (const page of recovered)
				pages.push(
					await tx.pages.create(scope, {
						userId: user.id,
						parentPageId: null,
						title: page.title,
						position: ++position,
					}),
				);
			const pageIds = new Map(
				recovered.map((page, index) => [page.id, pages[index]!.id]),
			);
			const canvasIds = new Map<string, string>();
			const findOwner = (id: string) => {
				const includes = (blocks: BlockJson[]): boolean =>
					blocks.some(
						(block) =>
							(block.type === "canvas" && block.props.canvasId === id) ||
							includes(block.children),
					);
				const index = recovered.findIndex((page) => includes(page.content));
				return pages[index]?.id ?? null;
			};
			const canvases = [];
			for (const canvas of recoveredCanvases) {
				const pageId = findOwner(canvas.id);
				const created = await tx.canvases.create(scope, {
					userId: user.id,
					pageId,
					title: pageId ? null : "Recovered canvas",
				});
				await tx.canvases.initializeSnapshot(
					scope,
					created.id,
					JSON.stringify(canvas.snapshot),
				);
				canvasIds.set(canvas.id, created.id);
				canvases.push(created);
			}
			const remapInline = (value: unknown): unknown => {
				if (!Array.isArray(value)) return value;
				return value.map((node) => {
					if (!node || typeof node !== "object") return node;
					const mapped = structuredClone(node);
					if (mapped.type === "mention" && pageIds.has(mapped.props?.pageId))
						mapped.props = {
							...mapped.props,
							pageId: pageIds.get(mapped.props.pageId),
							workspaceId: input.workspaceId,
						};
					if (mapped.content) mapped.content = remapInline(mapped.content);
					return mapped;
				});
			};
			const remap = (blocks: BlockJson[]): BlockJson[] =>
				blocks.map((block) => {
					const props = { ...block.props };
					if (
						block.type === "pageLink" &&
						typeof props.pageId === "string" &&
						pageIds.has(props.pageId)
					) {
						props.pageId = pageIds.get(props.pageId);
						props.workspaceId = input.workspaceId;
					}
					if (
						block.type === "canvas" &&
						typeof props.canvasId === "string" &&
						canvasIds.has(props.canvasId)
					)
						props.canvasId = canvasIds.get(props.canvasId);
					return {
						...block,
						id: crypto.randomUUID(),
						props,
						content: remapInline(block.content),
						children: remap(block.children),
					};
				});
			for (let index = 0; index < pages.length; index++) {
				const page = pages[index]!;
				const content = remap(recovered[index]!.content);
				await tx.pages.restoreContent(scope, page.id, content);
				// Recovery reconstructs task projections without resending historical assignment notifications.
				await reconcilePageDerivations(tx, scope, page, content, {
					defaultTaskAssigneeId: user.id,
				});
			}
			return { pages, canvases };
		});
		for (const page of result.pages)
			scheduleWorkspacePageEvent(ctx, {
				type: "page.created",
				workspaceId: input.workspaceId,
				pageId: page.id,
			});
		for (const canvas of result.canvases)
			scheduleWorkspaceCanvasEvent(ctx, {
				workspaceId: input.workspaceId,
				canvasId: canvas.id,
				pageId: canvas.pageId,
			});
		return {
			pages: result.pages.map(({ id, title }) => ({ id, title })),
			canvasIds: result.canvases.map(({ id }) => id),
		};
	});
