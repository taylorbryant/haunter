import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	canvasActivitySnapshot,
	mergeCanvasAgentActivity,
	receiveCanvasAgentActivity,
	clearCanvasAgentActivity,
	canvasAgentActivityKey,
} from "../client/canvas-activity-cache";
import { canvasActivity } from "./canvas-activity-fixture";

const event = canvasActivity();
const clock = { serverTime: Date.parse(event.occurredAt), receivedAt: 0 };

test("completion wins over delayed starts and duplicates cannot extend feedback or highlighting", () => {
	const completed = {
		...event,
		phase: "completed" as const,
		changedShapeIds: ["shape:a"],
	};
	const state = mergeCanvasAgentActivity([], completed, clock, 100);
	expect(canvasActivitySnapshot(state, event.canvasId, 100).shapeIds).toEqual([
		"shape:a",
	]);
	const late = mergeCanvasAgentActivity(state, event, clock, 1000);
	expect(late).toEqual(state);
	expect(mergeCanvasAgentActivity(late, completed, clock, 2000)).toEqual(state);
	expect(canvasActivitySnapshot(state, event.canvasId, 6001).shapeIds).toEqual(
		[],
	);
	expect(
		canvasActivitySnapshot(state, event.canvasId, 14_999).agents[0].phase,
	).toBe("completed");
	expect(canvasActivitySnapshot(state, event.canvasId, 15_001).agents).toEqual(
		[],
	);
	expect(mergeCanvasAgentActivity(state, event, clock, 61_000)).toEqual([]);
});

test("concurrent completions highlight independently while active calls take precedence", () => {
	const complete = canvasActivity({
		phase: "completed",
		changedShapeIds: ["shape:a"],
	});
	const other = canvasActivity({
		operationId: crypto.randomUUID(),
		phase: "completed",
		changedShapeIds: ["shape:b", "shape:a"],
	});
	let state = mergeCanvasAgentActivity([], complete, clock, 0);
	state = mergeCanvasAgentActivity(state, other, clock, 0);
	state = mergeCanvasAgentActivity(
		state,
		{ ...event, operationId: crypto.randomUUID() },
		clock,
		0,
	);
	const snapshot = canvasActivitySnapshot(state, event.canvasId, 1);
	expect(snapshot.agents).toHaveLength(1);
	expect(snapshot.agents[0].phase).toBe("active");
	expect(snapshot.shapeIds).toEqual(["shape:a", "shape:b"]);
	expect(canvasActivitySnapshot(state, crypto.randomUUID(), 1).agents).toEqual(
		[],
	);
	expect(canvasActivitySnapshot(state, event.canvasId, 60_001).agents).toEqual(
		[],
	);
});

test("failure ends activity without highlights even with a late terminal event", () => {
	let state = mergeCanvasAgentActivity([], event, clock, 0);
	state = mergeCanvasAgentActivity(
		state,
		{ ...event, phase: "failed", changedShapeIds: ["shape:a"] },
		clock,
		20_000,
	);
	expect(canvasActivitySnapshot(state, event.canvasId, 20_000).agents).toEqual(
		[],
	);
	expect(
		canvasActivitySnapshot(state, event.canvasId, 20_000).shapeIds,
	).toEqual([]);
	expect(mergeCanvasAgentActivity(state, event, clock, 21_000)).toEqual(state);
});

test("cached activity is scoped to the viewer and workspace and clears on teardown", () => {
	const client = new QueryClient();
	try {
		const reference = {
			serverTime: clock.serverTime,
			receivedAt: performance.now(),
		};
		receiveCanvasAgentActivity(client, "viewer", "other", event, reference);
		expect(
			client.getQueryData<unknown[]>(canvasAgentActivityKey("viewer", "other")),
		).toBeUndefined();
		receiveCanvasAgentActivity(
			client,
			"viewer",
			event.workspaceId,
			event,
			reference,
		);
		expect(
			client.getQueryData<unknown[]>(
				canvasAgentActivityKey("viewer", event.workspaceId),
			),
		).toHaveLength(1);
		expect(
			client.getQueryData<unknown[]>(
				canvasAgentActivityKey("other", event.workspaceId),
			),
		).toBeUndefined();
		clearCanvasAgentActivity(client, "viewer", event.workspaceId);
		expect(
			client.getQueryData<unknown[]>(
				canvasAgentActivityKey("viewer", event.workspaceId),
			),
		).toEqual([]);
	} finally {
		client.clear();
	}
});
