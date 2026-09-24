import "@beignet/core/server-only";
import { z } from "zod";
import { defineAgentCapability } from "@/lib/agent-capabilities";
import { AGENT_CAPABILITY_DESCRIPTIONS } from "@/features/agents/capability-catalog";
import {
	PageEditOutputSchema,
	PageRevisionSchema,
} from "@/features/pages/block-editing";
import {
	ReadCanvasInputSchema,
	EditCanvasInputSchema,
	DeleteCanvasShapesInputSchema,
	CanvasReadOutputSchema,
	CanvasEditOutputSchema,
} from "./editing";
const workspace = { workspaceId: z.string().min(1) };

export const canvasAgentCapabilities = [
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
