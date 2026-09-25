import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import {
	CanvasEditOutputSchema,
	EditCanvasInputSchema,
} from "@/features/canvases/editing";
import { workspaceCanvasActivity } from "@/features/collab/channels";
import type { AgentPrincipal } from "@/lib/agent-capabilities";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import type { CanvasAgentActivity } from "../canvas-activity";

const actions: Record<string, CanvasAgentActivity["action"]> = {
	read_canvas: "read",
	preview_canvas: "preview",
	edit_canvas: "edit",
	delete_canvas_shapes: "delete",
};
const TIMEOUT_MS = 1_000;
export type FinishCanvasActivity = (
	phase: "completed" | "failed",
	output?: unknown,
) => Promise<void>;

async function publish(
	ctx: AppContext,
	event: CanvasAgentActivity,
	timeout = TIMEOUT_MS,
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			ctx.ports.broadcast.publish(workspaceCanvasActivity, {
				params: { workspaceId: event.workspaceId },
				event: "activity",
				data: event,
			}),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeout);
			}),
		]);
	} catch {
		// Optional feedback must not fail an authoritative canvas operation.
	} finally {
		clearTimeout(timer);
	}
}

function changedShapes(
	args: unknown,
	output: unknown,
	canvasId: string,
): string[] {
	const input = EditCanvasInputSchema.safeParse(args);
	const result = CanvasEditOutputSchema.safeParse(output);
	if (!input.success || !result.success || result.data.canvasId !== canvasId)
		return [];
	const created = result.data.createdShapes;
	const ids = input.data.operations.flatMap((operation) => {
		const target =
			operation.op === "update" ? operation.shapeId : operation.ref;
		return target.startsWith("shape:")
			? [target]
			: created[target]
				? [created[target]]
				: [];
	});
	return [...new Set(ids)]
		.filter((id) => /^shape:.+/.test(id) && id.length <= 200)
		.slice(0, 100);
}

/** Runs after grant validation and workspace membership resolution. Resource
 * authorization is checked before broadcasting any canvas or identity data. */
export async function startCanvasAgentActivity({
	ctx,
	principal,
	capability,
	args,
}: {
	ctx: AppContext;
	principal: AgentPrincipal;
	capability: string;
	args: Record<string, unknown> | undefined;
}): Promise<FinishCanvasActivity | undefined> {
	const action = actions[capability];
	if (
		!action ||
		typeof args?.canvasId !== "string" ||
		typeof args.workspaceId !== "string" ||
		!ctx.ports.workspaceEventStreamLeases.isConfigured()
	)
		return;
	const canvasId = args.canvasId;
	const workspaceId = args.workspaceId;
	const { workspaceId: _, ...commandArgs } = args;
	let cancelled = false;
	const deadline = performance.now() + TIMEOUT_MS;
	const expired = () => cancelled || performance.now() >= deadline;
	let timer: ReturnType<typeof setTimeout> | undefined;
	async function prepare(): Promise<CanvasAgentActivity | undefined> {
		const scope = requireActiveWorkspaceScope(ctx, workspaceId);
		const canvas = await ctx.ports.canvases.findMetaById(scope, canvasId);
		if (expired() || !canvas) return;
		const write = action === "edit" || action === "delete";
		await ctx.gate.authorize(
			write ? "canvases.update" : "canvases.read",
			canvas,
		);
		if (expired()) return;
		if (canvas.pageId) {
			const page = await ctx.ports.pages.findMetaById(scope, canvas.pageId);
			if (expired() || !page || page.deletedAt) return;
			await ctx.gate.authorize(write ? "pages.update" : "pages.read", page);
			if (expired()) return;
		}
		const members = await ctx.ports.members.listByWorkspace(scope);
		if (expired()) return;
		const owner = members.find((member) => member.userId === principal.userId);
		if (!owner) return;
		let agentName = principal.remoteClientName?.trim() || "MCP agent";
		if (principal.transport !== "remote-mcp") {
			const agents = await ctx.ports.agents.listByUser(principal.userId);
			if (expired()) return;
			const agent = agents.find(
				(agent) =>
					agent.id === principal.agentId && agent.userId === principal.userId,
			);
			if (!agent) return;
			agentName = agent.name.trim() || "Agent";
		}
		const now = new Date().toISOString();
		return {
			schemaVersion: 1,
			type: "agent.canvasActivity",
			workspaceId: canvas.workspaceId,
			canvasId: canvas.id,
			pageId: canvas.pageId,
			operationId: crypto.randomUUID(),
			agentId: principal.agentId,
			agentName: agentName.slice(0, 100),
			userId: principal.userId,
			userName: owner.name.trim().slice(0, 100) || "Workspace member",
			action,
			phase: "active",
			startedAt: now,
			occurredAt: now,
			changedShapeIds: [],
		};
	}
	try {
		const event = await Promise.race([
			prepare(),
			new Promise<undefined>((resolve) => {
				timer = setTimeout(() => {
					cancelled = true;
					resolve(undefined);
				}, TIMEOUT_MS);
			}),
		]);
		if (!event || expired()) return;
		await publish(ctx, event, Math.max(1, deadline - performance.now()));
		return (phase, output) =>
			publish(ctx, {
				...event,
				phase,
				occurredAt: new Date().toISOString(),
				changedShapeIds:
					phase === "completed" && action === "edit"
						? changedShapes(commandArgs, output, canvasId)
						: [],
			});
	} catch {
		return;
	} finally {
		cancelled = true;
		clearTimeout(timer);
	}
}
