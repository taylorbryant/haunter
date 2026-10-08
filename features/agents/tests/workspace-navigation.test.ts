import { expect, test } from "bun:test";
import {
	parseWorkspacePath,
	workspaceTargetPath,
} from "../mcp-app/workspace-bridge";

test("embedded task filters remain local and preserve the workspace identity", () => {
	expect(
		parseWorkspacePath("/w/team/tasks?filter=completed&scope=mine"),
	).toMatchObject({
		workspaceId: "team",
		section: "tasks",
		view: "tasks",
		filter: "completed",
		scope: "mine",
	});
	expect(parseWorkspacePath("/w/team/tasks?compose=1").section).toBe("tasks");
	for (const path of [
		"https://other.test/w/team/tasks",
		"/w/team/home?scope=mine",
		"/w/team/tasks?filter=bad",
		"/w/team/tasks?scope=mine&scope=everyone",
		"/w/team/tasks?next=https://other.test",
		"/w/team/tasks?toString=x",
		"/w/team/tasks#escape",
		"/w/team/tasks?taskId=not-a-task",
		"/w/../tasks",
	])
		expect(() => parseWorkspacePath(path)).toThrow();
});

test("assistant task targets round trip with their filters", () => {
	const target = {
		workspaceId: "team / 文档",
		view: "tasks" as const,
		taskId: crypto.randomUUID(),
		filter: "all" as const,
		scope: "everyone" as const,
	};
	expect(parseWorkspacePath(workspaceTargetPath(target))).toEqual({
		...target,
		section: "tasks",
	});
});

test("canvas search links allow only scoped drawing destinations and valid shape IDs", () => {
	const pageId = crypto.randomUUID();
	const canvasId = crypto.randomUUID();
	expect(
		parseWorkspacePath(
			`/w/team/p/${pageId}?canvasId=${canvasId}&shapeId=shape%3Amatch`,
		).pageId,
	).toBe(pageId);
	expect(
		parseWorkspacePath(`/w/team/c/${canvasId}?shapeId=shape%3Amatch`).canvasId,
	).toBe(canvasId);
	for (const path of [
		`/w/team/p/${pageId}?shapeId=shape%3Amatch`,
		`/w/team/p/${pageId}?canvasId=bad`,
		`/w/team/c/${canvasId}?shapeId=asset%3Amatch`,
		`/w/team/c/${canvasId}?shapeId=shape%3Aone&shapeId=shape%3Atwo`,
		`/w/team/c/${canvasId}?canvasId=${canvasId}`,
		`/w/team/home?canvasId=${canvasId}`,
		`/w/team/p/${pageId}?canvasId=${canvasId}&next=https://other.test`,
	])
		expect(() => parseWorkspacePath(path)).toThrow();
});
