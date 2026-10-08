import { z } from "zod";
import {
	TaskViewSchema,
	SelectedTaskSchema,
} from "@/features/tasks/current-view";
import {
	CanvasSelectionSchema,
	MAX_SELECTION_CHARACTERS,
} from "./editor-schema";

export const WorkspaceTargetSchema = z
	.object({
		workspaceId: z
			.string()
			.min(1)
			.max(200)
			.refine((id) => id !== "." && id !== ".."),
		pageId: z.uuid().optional(),
		canvasId: z.uuid().optional(),
		view: z.enum(["home", "tasks"]).optional(),
		taskId: z.uuid().optional(),
		filter: z.enum(["open", "completed", "all"]).optional(),
		scope: z.enum(["mine", "everyone"]).optional(),
	})
	.refine((target) => !(target.pageId && target.canvasId))
	.refine(
		(target) =>
			!(target.pageId || target.canvasId) ||
			!(target.view || target.taskId || target.filter || target.scope),
	)
	.refine(
		(target) =>
			!(target.taskId || target.filter || target.scope) ||
			target.view === "tasks",
	);
export type WorkspaceTarget = z.infer<typeof WorkspaceTargetSchema>;

export const WorkspaceViewSchema = z
	.object({
		workspaceId: z.string().min(1),
		workspaceName: z.string().max(1000),
		pageId: z.uuid().nullable(),
		canvasId: z.uuid().optional(),
		section: z.enum(["home", "tasks"]).optional(),
		tasks: TaskViewSchema.optional(),
		selectedTask: SelectedTaskSchema.optional(),
		title: z.string().max(10000),
		url: z.url(),
		source: z.string().max(200),
		editorStatus: z.enum(["opening", "ready", "unavailable"]),
		saveStatus: z.enum(["unknown", "saved", "unsaved"]),
		selection: z
			.object({
				text: z.string().max(MAX_SELECTION_CHARACTERS),
				complete: z.boolean(),
			})
			.optional(),
		canvas: CanvasSelectionSchema.optional(),
		inlineCanvas: z
			.object({ canvasId: z.uuid(), selection: CanvasSelectionSchema })
			.optional(),
	})
	.refine(
		(view) =>
			!view.section ||
			(!view.pageId &&
				!view.canvasId &&
				!view.selectedTask &&
				!view.selection &&
				!view.inlineCanvas),
	)
	.refine((view) => !view.tasks || !!view.section)
	.refine(
		(view) =>
			!view.selectedTask ||
			(view.selectedTask.pageId === view.pageId && !view.canvasId),
	);

export const WorkspaceBridgeMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("haunter/workspace/authorize"),
		nonce: z.string(),
		workspaceId: z.string().min(1),
		requestId: z.uuid(),
		challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	}),
	z.object({ type: z.literal("haunter/workspace/ready"), nonce: z.string() }),
	z.object({
		type: z.literal("haunter/workspace/view"),
		nonce: z.string(),
		view: WorkspaceViewSchema.nullable(),
	}),
	z.object({
		type: z.literal("haunter/editor/flushed"),
		nonce: z.string(),
		requestId: z.uuid(),
		locallySaved: z.boolean(),
		saved: z.boolean(),
	}),
	z.object({
		type: z.literal("haunter/workspace/open-web"),
		nonce: z.string(),
		path: z.string().max(1000),
	}),
]);

export function workspaceTargetPath(target: WorkspaceTarget) {
	if (target.view === "tasks") {
		const params = new URLSearchParams();
		if (target.filter) params.set("filter", target.filter);
		if (target.scope) params.set("scope", target.scope);
		if (target.taskId) params.set("taskId", target.taskId);
		return `/w/${encodeURIComponent(target.workspaceId)}/tasks${params.size ? `?${params}` : ""}`;
	}
	return `/w/${encodeURIComponent(target.workspaceId)}/${target.canvasId ? `c/${target.canvasId}` : target.pageId ? `p/${target.pageId}` : "home"}`;
}

export function parseWorkspacePath(path: string) {
	const [pathname, search] = path.split("?");
	if (path.includes("#") || path.split("?").length > 2)
		throw new Error("This destination is not available in embedded Haunter.");
	const params = new URLSearchParams(search);
	for (const [key, value] of params) {
		const taskValues = {
			filter: ["open", "completed", "all"],
			scope: ["mine", "everyone"],
			compose: ["1"],
		};
		const taskParam =
			pathname.endsWith("/tasks") &&
			(key === "taskId"
				? z.uuid().safeParse(value).success
				: Object.hasOwn(taskValues, key) &&
					taskValues[key as keyof typeof taskValues].includes(value));
		const canvasParam =
			/\/p\/[^/]+$/.test(pathname) &&
			key === "canvasId" &&
			z.uuid().safeParse(value).success;
		const shapeParam =
			key === "shapeId" &&
			z.string().startsWith("shape:").min(7).max(512).safeParse(value)
				.success &&
			(/\/c\/[^/]+$/.test(pathname) ||
				(/\/p\/[^/]+$/.test(pathname) &&
					z.uuid().safeParse(params.get("canvasId")).success));
		if (
			(!taskParam && !canvasParam && !shapeParam) ||
			params.getAll(key).length !== 1
		)
			throw new Error("This destination is not available in embedded Haunter.");
	}
	const match =
		/^\/w\/([^/]+)\/(home|tasks|canvases|trash|p\/[0-9a-f-]{36}|c\/[0-9a-f-]{36})$/i.exec(
			pathname,
		);
	if (!match)
		throw new Error("This destination is not available in embedded Haunter.");
	const target = WorkspaceTargetSchema.parse({
		workspaceId: decodeURIComponent(match[1]),
		...(match[2] === "tasks"
			? {
					view: "tasks",
					taskId: params.get("taskId") ?? undefined,
					filter: params.get("filter") ?? undefined,
					scope: params.get("scope") ?? undefined,
				}
			: {}),
		...(match[2].startsWith("p/")
			? { pageId: match[2].slice(2) }
			: match[2].startsWith("c/")
				? { canvasId: match[2].slice(2) }
				: {}),
	});
	return { ...target, section: match[2] };
}
