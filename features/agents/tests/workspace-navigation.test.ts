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
