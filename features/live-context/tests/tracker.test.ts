import { expect, test } from "bun:test";
import { contextRoute, LiveContextTracker } from "../client/tracker";
import { textEditingFixture } from "./helpers";
import {
	PublishContextInputSchema,
	type PublishContextInput,
	type CanvasSelection,
} from "../schemas";

const pageId = crypto.randomUUID(),
	canvasId = crypto.randomUUID();
const route = { workspaceId: "workspace", pageId, canvasId: null };
const selection: CanvasSelection = {
	canvasId,
	canvasPageId: "page:one",
	selectedShapeIds: ["shape:a", "shape:b"],
	selectionCount: 2,
	textEditing: textEditingFixture,
};
function fixture() {
	let now = 1000;
	const calls: PublishContextInput[] = [];
	const tracker = new LiveContextTracker(
		"user",
		async (input) => {
			calls.push(PublishContextInputSchema.parse(input));
		},
		() => now,
	);
	return {
		tracker,
		calls,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

test("keeps the captured selection across blur and heartbeat without making it look newly selected", async () => {
	const { tracker, calls, advance } = fixture();
	tracker.navigate(route);
	tracker.presence(true, true);
	tracker.canvas("workspace", pageId, selection, true);
	await tracker.flush();
	advance(12_000);
	tracker.presence(false, false);
	tracker.heartbeat();
	await tracker.flush();
	expect(calls.at(-1)).toMatchObject({
		view: { pageId, canvas: selection },
		contextAgeMs: 12_000,
		reportedAt: 13_000,
		visible: false,
		focused: false,
	});
	expect(calls.at(-1)!.sequence).toBeGreaterThan(calls[0].sequence);
});

test("a queued report keeps its original timestamp while a new heartbeat gets a fresh one", async () => {
	const { tracker, calls, advance } = fixture();
	tracker.navigate(route);
	advance(130_000);
	await tracker.flush();
	expect(calls[0]).toMatchObject({ reportedAt: 1000, contextAgeMs: 130_000 });
	tracker.heartbeat();
	await tracker.flush();
	expect(calls[1]).toMatchObject({
		reportedAt: 131_000,
		contextAgeMs: 130_000,
	});
});

test("switching canvases ignores background updates and cleanup from the old canvas", async () => {
	const { tracker, calls } = fixture();
	const other = { ...selection, canvasId: crypto.randomUUID() };
	tracker.navigate(route);
	tracker.canvas("workspace", pageId, selection, true);
	tracker.canvas("workspace", pageId, other, true);
	tracker.canvas("workspace", pageId, selection, false);
	tracker.clearCanvas(canvasId);
	await tracker.flush();
	expect(calls.at(-1)?.view?.canvas?.canvasId).toBe(other.canvasId);
	tracker.clearCanvas();
	await tracker.flush();
	expect(calls.at(-1)?.view).toEqual({ pageId, canvas: null });
});

test("navigation clears selection and refuses callbacks from an old page or workspace", async () => {
	const { tracker, calls } = fixture();
	tracker.navigate(route);
	tracker.canvas("workspace", pageId, selection, true);
	const nextId = crypto.randomUUID();
	tracker.navigate({ ...route, pageId: nextId });
	tracker.canvas("workspace", pageId, selection, true);
	tracker.canvas("other-workspace", nextId, selection, true);
	await tracker.flush();
	expect(calls.at(-1)?.view).toEqual({ pageId: nextId, canvas: null });
	tracker.navigate(null);
	await tracker.flush();
	expect(calls.at(-1)?.view).toBeNull();
});

test("standalone canvases have an internal canvas page, and oversized selections are explicit", async () => {
	const { tracker, calls } = fixture();
	tracker.navigate({ workspaceId: "workspace", pageId: null, canvasId });
	tracker.canvas(
		"workspace",
		null,
		{
			...selection,
			canvasPageId: "page:two",
			selectedShapeIds: Array.from({ length: 101 }, (_, i) => "shape:" + i),
			selectionCount: 101,
		},
		true,
	);
	await tracker.flush();
	expect(calls.at(-1)?.view?.canvas?.canvasPageId).toBe("page:two");
	expect(calls.at(-1)?.view?.canvas?.selectedShapeIds).toHaveLength(100);
	expect(calls.at(-1)?.view?.canvas?.selectionCount).toBe(101);
});

test("coalesces changes while a request is pending and recovers after a failed request", async () => {
	let release!: () => void;
	const barrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	const calls: PublishContextInput[] = [];
	const tracker = new LiveContextTracker("user", async (input) => {
		calls.push(input);
		if (calls.length === 1) {
			await barrier;
			throw new Error("offline");
		}
	});
	tracker.navigate(route);
	const flight = tracker.flush();
	tracker.canvas("workspace", pageId, selection, true);
	tracker.navigate({ ...route, pageId: crypto.randomUUID() });
	release();
	await flight;
	await tracker.flush();
	expect(calls).toHaveLength(2);
	expect(calls[1].view?.canvas).toBeNull();
	expect(calls[1].sequence).toBeGreaterThan(calls[0].sequence);
});

test("tabs have distinct identities and route parsing distinguishes pages, canvases and other screens", () => {
	expect(fixture().tracker.sessionId).not.toBe(fixture().tracker.sessionId);
	expect(contextRoute("/w/workspace/p/" + pageId)).toEqual(route);
	expect(contextRoute("/w/workspace/c/" + canvasId)).toEqual({
		workspaceId: "workspace",
		pageId: null,
		canvasId,
	});
	expect(contextRoute("/w/workspace/home")).toEqual({
		workspaceId: "workspace",
		pageId: null,
		canvasId: null,
	});
	expect(contextRoute("/share/something")).toBeNull();
});
