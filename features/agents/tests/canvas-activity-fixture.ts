import { createTestCanvasRepository } from "@/features/canvases/tests/helpers";
import {
	CanvasAgentActivitySchema,
	type CanvasAgentActivity,
} from "../canvas-activity";
import { workspaceCanvasActivity } from "@/features/collab/channels";
import { executeRemoteMcpCapability } from "@/server/agent-capabilities";
import { pageActivityFixture, activity } from "./page-activity-fixture";

export function canvasActivity(
	overrides: Partial<CanvasAgentActivity> = {},
): CanvasAgentActivity {
	return {
		...activity(),
		type: "agent.canvasActivity",
		canvasId: "00000000-0000-4000-8000-000000000003",
		action: "edit",
		changedShapeIds: [],
		...overrides,
	};
}

export async function canvasActivityFixture(
	options: Parameters<typeof pageActivityFixture>[0] & {
		standalone?: boolean;
	} = {},
) {
	const f = await pageActivityFixture(options);
	const events: CanvasAgentActivity[] = [];
	f.ports.broadcast.publish = async (channel, event) => {
		if (
			channel.name !== workspaceCanvasActivity.name ||
			event.event !== "activity"
		)
			throw new Error("Canvas activity must use its dedicated channel");
		events.push(CanvasAgentActivitySchema.parse(event.data));
	};
	f.ports.canvases = createTestCanvasRepository();
	const canvas = await f.ports.canvases.create(f.scope, {
		userId: f.userId,
		pageId: options.standalone ? null : f.page.id,
		title: "Private canvas",
	});
	f.ports.canvasEditing = {
		async execute({ command }) {
			if (command.action === "preview")
				return {
					canvasId: canvas.id,
					revision: "v1",
					pageId: "page:one",
					shapeIds: [],
					bounds: { x: 0, y: 0, width: 1, height: 1 },
					width: 1,
					height: 1,
					image: { mimeType: "image/png" as const, data: "private-image-data" },
				};
			if (command.action === "read")
				return {
					canvasId: canvas.id,
					revision: "v1",
					pages: [],
					shapes: [],
					bindings: [],
					history: [],
				};
			return {
				canvasId: canvas.id,
				revision: "v2",
				historyVersionId: crypto.randomUUID(),
				createdShapes: { box: "shape:new", arrow: "shape:arrow" },
			};
		},
	};
	return {
		...f,
		events,
		canvas,
		execute(capability = "edit_canvas", args: Record<string, unknown> = {}) {
			return executeRemoteMcpCapability(
				{
					capability,
					arguments: {
						workspaceId: f.workspaceId,
						canvasId: canvas.id,
						...(capability === "edit_canvas"
							? {
									expectedRevision: "v1",
									operations: [
										{
											op: "update",
											shapeId: "shape:old",
											text: "Private selected text",
										},
									],
								}
							: {}),
						...args,
					},
					userId: f.userId,
					clientId: "client",
				},
				{ getServer: async () => f.server },
			);
		},
	};
}
