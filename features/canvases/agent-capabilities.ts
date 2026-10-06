import "@beignet/core/server-only";
import { z } from "zod";
import { defineAgentCapability } from "@/lib/agent-capabilities";
import { AGENT_CAPABILITY_DESCRIPTIONS } from "@/features/agents/capability-catalog";
import {
	PageEditOutputSchema,
	PageRevisionSchema,
} from "@/features/pages/block-editing";
import {
	InsertCanvasLibraryItemInputSchema,
	InsertCanvasLibraryItemOutputSchema,
	ReadCanvasInputSchema,
	EditCanvasInputSchema,
	DeleteCanvasShapesInputSchema,
	CanvasReadOutputSchema,
	CanvasEditOutputSchema,
	PreviewCanvasInputSchema,
	CanvasPreviewOutputSchema,
} from "./editing";
import {
	SearchCanvasLibraryInputSchema,
	SearchCanvasLibraryOutputSchema,
} from "./library-schemas";
import {
	CanvasListItemSchema,
	SetCanvasFavoriteOutputSchema,
	UpdateCanvasBodySchema,
	type CanvasListItem,
} from "./schemas";
const workspace = { workspaceId: z.string().min(1) };
const CanvasMetadata = CanvasListItemSchema.omit({
	id: true,
	userId: true,
}).extend({ canvasId: z.uuid() });
const CanvasInput = z.object({ ...workspace, canvasId: z.uuid() });
function canvasMetadata({ id, userId: _, ...canvas }: CanvasListItem) {
	return CanvasMetadata.parse({ ...canvas, canvasId: id });
}

export const canvasAgentCapabilities = [
	defineAgentCapability("list_canvases", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.list_canvases,
		input: z.object(workspace),
		output: z.object({ canvases: z.array(CanvasMetadata) }),
		async handle({ ctx, input }) {
			const { listCanvasesUseCase } = await import("./use-cases/list-canvases");
			const { items } = await listCanvasesUseCase.run({ ctx, input });
			return { canvases: items.map(canvasMetadata) };
		},
	}),
	defineAgentCapability("create_canvas", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.create_canvas,
		input: z.object(workspace).extend(UpdateCanvasBodySchema.shape).strict(),
		output: CanvasMetadata,
		async handle({ ctx, input }) {
			const { createCanvasUseCase } = await import("./use-cases/create-canvas");
			return canvasMetadata(await createCanvasUseCase.run({ ctx, input }));
		},
	}),
	defineAgentCapability("update_canvas", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.update_canvas,
		input: CanvasInput.extend(UpdateCanvasBodySchema.shape),
		output: CanvasMetadata,
		async handle({ ctx, input }) {
			const { updateCanvasUseCase } = await import("./use-cases/update-canvas");
			return canvasMetadata(
				await updateCanvasUseCase.run({
					ctx,
					input: { id: input.canvasId, title: input.title },
				}),
			);
		},
	}),
	defineAgentCapability("delete_canvas", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.delete_canvas,
		input: CanvasInput,
		output: z.object({ canvasId: z.uuid(), deleted: z.literal(true) }),
		async handle({ ctx, input }) {
			const { deleteCanvasUseCase } = await import("./use-cases/delete-canvas");
			await deleteCanvasUseCase.run({ ctx, input: { id: input.canvasId } });
			return { canvasId: input.canvasId, deleted: true as const };
		},
	}),
	defineAgentCapability("list_canvas_favorites", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.list_canvas_favorites,
		input: z.object(workspace),
		output: z.object({
			canvases: z.array(
				CanvasMetadata.extend({ favoritedAt: z.string().nullable() }),
			),
		}),
		async handle({ ctx, input }) {
			const { getCanvasNavigationUseCase } = await import(
				"./use-cases/get-canvas-navigation"
			);
			const { favorites } = await getCanvasNavigationUseCase.run({
				ctx,
				input,
			});
			return {
				canvases: favorites.map((canvas) => ({
					...canvasMetadata(canvas),
					favoritedAt: canvas.favoritedAt,
				})),
			};
		},
	}),
	defineAgentCapability("set_canvas_favorite", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.set_canvas_favorite,
		input: CanvasInput.extend({ favorite: z.boolean() }),
		output: SetCanvasFavoriteOutputSchema,
		async handle({ ctx, input }) {
			const { setCanvasFavoriteUseCase } = await import(
				"./use-cases/set-canvas-favorite"
			);
			return setCanvasFavoriteUseCase.run({
				ctx,
				input: { id: input.canvasId, favorite: input.favorite },
			});
		},
	}),
	defineAgentCapability("search_canvas_library", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.search_canvas_library,
		input: SearchCanvasLibraryInputSchema,
		output: SearchCanvasLibraryOutputSchema,
		async handle({ ctx, input }) {
			const { searchCanvasLibraryUseCase } = await import(
				"./use-cases/search-canvas-library"
			);
			return searchCanvasLibraryUseCase.run({ ctx, input });
		},
	}),
	defineAgentCapability("insert_canvas_library_item", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.insert_canvas_library_item,
		input: InsertCanvasLibraryItemInputSchema.extend(workspace),
		output: InsertCanvasLibraryItemOutputSchema,
		async handle({ ctx, input: { workspaceId: _, ...input } }) {
			const { canvasCommandUseCase } = await import("./use-cases/edit-canvas");
			return InsertCanvasLibraryItemOutputSchema.parse(
				await canvasCommandUseCase.run({
					ctx,
					input: { ...input, action: "insert-library" },
				}),
			);
		},
	}),
	defineAgentCapability("preview_canvas", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.preview_canvas,
		input: PreviewCanvasInputSchema.extend(workspace),
		output: CanvasPreviewOutputSchema,
		async handle({ ctx, input: { workspaceId: _, ...input } }) {
			const { canvasCommandUseCase } = await import("./use-cases/edit-canvas");
			return CanvasPreviewOutputSchema.parse(
				await canvasCommandUseCase.run({
					ctx,
					input: { ...input, action: "preview" },
				}),
			);
		},
	}),
	defineAgentCapability("create_canvas_block", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.create_canvas_block,
		input: z.object({
			...workspace,
			pageId: z.uuid(),
			expectedRevision: PageRevisionSchema,
		}),
		output: PageEditOutputSchema.extend({
			canvasId: z.uuid(),
			canvasRevision: z.string(),
		}),
		async handle({ ctx, input }) {
			const { createCanvasBlockUseCase } = await import(
				"./use-cases/create-canvas-block"
			);
			return createCanvasBlockUseCase.run({
				ctx,
				input: {
					pageId: input.pageId,
					expectedRevision: input.expectedRevision,
				},
			});
		},
	}),
	defineAgentCapability("read_canvas", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.read_canvas,
		input: ReadCanvasInputSchema.extend(workspace),
		output: CanvasReadOutputSchema,
		async handle({ ctx, input: { workspaceId: _, ...input } }) {
			const { canvasCommandUseCase } = await import("./use-cases/edit-canvas");
			return CanvasReadOutputSchema.parse(
				await canvasCommandUseCase.run({
					ctx,
					input: { ...input, action: "read" },
				}),
			);
		},
	}),
	defineAgentCapability("edit_canvas", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.edit_canvas,
		input: EditCanvasInputSchema.extend(workspace),
		output: CanvasEditOutputSchema,
		async handle({ ctx, input: { workspaceId: _, ...input } }) {
			const { canvasCommandUseCase } = await import("./use-cases/edit-canvas");
			return CanvasEditOutputSchema.parse(
				await canvasCommandUseCase.run({
					ctx,
					input: { ...input, action: "edit" },
				}),
			);
		},
	}),
	defineAgentCapability("delete_canvas_shapes", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.delete_canvas_shapes,
		input: DeleteCanvasShapesInputSchema.extend(workspace),
		output: CanvasEditOutputSchema,
		async handle({ ctx, input: { workspaceId: _, ...input } }) {
			const { canvasCommandUseCase } = await import("./use-cases/edit-canvas");
			return CanvasEditOutputSchema.parse(
				await canvasCommandUseCase.run({
					ctx,
					input: { ...input, action: "delete" },
				}),
			);
		},
	}),
] as const;
