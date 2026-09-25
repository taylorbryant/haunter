import { expect, test } from "bun:test";
import { isCanvasAgentActivity } from "../canvas-activity";
import { canvasActivityFixture } from "./canvas-activity-fixture";
import { createHaunterAgentCapabilityExecutor } from "@/server/agent-capabilities";
import { createTestAgentAdminRepository } from "./helpers";

test.each([false, true])(
	"authorized canvas activity is attributed and scoped (standalone=%s)",
	async (standalone) => {
		const f = await canvasActivityFixture({ standalone });
		const result = await f.execute();
		expect(result).toMatchObject({ canvasId: f.canvas.id, revision: "v2" });
		expect(f.events).toHaveLength(2);
		expect(f.events.every(isCanvasAgentActivity)).toBe(true);
		expect(f.events[0]).toMatchObject({
			phase: "active",
			canvasId: f.canvas.id,
			pageId: f.canvas.pageId,
			agentName: "Codex",
			userName: "Taylor",
			changedShapeIds: [],
		});
		expect(f.events[1]).toMatchObject({
			phase: "completed",
			operationId: f.events.filter(isCanvasAgentActivity)[0].operationId,
			changedShapeIds: ["shape:old"],
		});
		expect(JSON.stringify(f.events)).not.toContain("Private");
	},
);

test("successful batches resolve created refs and deduplicate changed shape IDs", async () => {
	const f = await canvasActivityFixture();
	await f.execute("edit_canvas", {
		operations: [
			{ op: "create", ref: "box", type: "rectangle", x: 0, y: 0 },
			{ op: "update", shapeId: "box", text: "Private" },
			{ op: "update", shapeId: "shape:old", x: 10 },
			{ op: "connect", ref: "arrow", fromId: "box", toId: "shape:old" },
		],
	});
	expect(f.events[1]).toMatchObject({
		changedShapeIds: ["shape:new", "shape:old", "shape:arrow"],
	});
});

test("reads and deletions show status without highlighting shapes that were not updated", async () => {
	const f = await canvasActivityFixture({ profile: "full" });
	await f.execute("read_canvas");
	await f.execute("preview_canvas");
	await f.execute("delete_canvas_shapes", {
		expectedRevision: "v1",
		shapeIds: ["shape:old"],
	});
	expect(
		f.events
			.filter(isCanvasAgentActivity)
			.map((event) => [event.action, event.phase, event.changedShapeIds]),
	).toEqual([
		["read", "active", []],
		["read", "completed", []],
		["preview", "active", []],
		["preview", "completed", []],
		["delete", "active", []],
		["delete", "completed", []],
	]);
	expect(JSON.stringify(f.events)).not.toContain("private-image-data");
});

test("invalid input, denied grants, missing membership, and missing or archived resources never announce activity", async () => {
	const denied = await canvasActivityFixture({ profile: "view" });
	await expect(denied.execute()).rejects.toThrow();
	expect(denied.events).toEqual([]);
	const f = await canvasActivityFixture();
	await expect(
		f.execute("read_canvas", { canvasId: "invalid" }),
	).rejects.toThrow();
	await expect(
		f.execute("read_canvas", { canvasId: crypto.randomUUID() }),
	).rejects.toThrow();
	await expect(
		f.execute("read_canvas", { workspaceId: "other" }),
	).rejects.toThrow();
	await f.pages.setDeletedByIds(f.scope, [f.page.id], new Date().toISOString());
	await expect(f.execute()).rejects.toThrow();
	f.setRole(null);
	await expect(f.execute("read_canvas")).rejects.toThrow();
	expect(f.events).toEqual([]);
});

test("current viewer role denies editing activity, but allows reading", async () => {
	const f = await canvasActivityFixture({ role: "viewer" });
	await expect(f.execute()).rejects.toThrow();
	expect(f.events).toEqual([]);
	await f.execute("read_canvas");
	expect(f.events).toHaveLength(2);
});

test("failures finish the operation without exposing error details or highlighting", async () => {
	const f = await canvasActivityFixture();
	f.ports.canvasEditing.execute = async () => {
		throw new Error("Private backend detail");
	};
	await expect(f.execute()).rejects.toThrow();
	expect(f.events[1]).toMatchObject({ phase: "failed", changedShapeIds: [] });
	expect(JSON.stringify(f.events)).not.toContain("Private backend");
});

test("disabled or broken broadcasting does not fail canvas operations", async () => {
	const disabled = await canvasActivityFixture({ configured: false });
	await disabled.execute();
	expect(disabled.events).toEqual([]);
	const f = await canvasActivityFixture();
	f.ports.broadcast.publish = async () => {
		throw new Error("Offline");
	};
	await expect(f.execute()).resolves.toMatchObject({ revision: "v2" });
});

test("a timed-out preparation never publishes later or blocks the canvas action", async () => {
	const f = await canvasActivityFixture();
	const blocked = Promise.withResolvers<void>();
	const find = f.ports.canvases.findMetaById;
	f.ports.canvases.findMetaById = async (...args) => {
		await blocked.promise;
		return find(...args);
	};
	const timeout = setTimeout(() => blocked.resolve(), 2500);
	try {
		const start = performance.now();
		await expect(f.execute()).resolves.toMatchObject({ revision: "v2" });
		expect(performance.now() - start).toBeLessThan(2000);
	} finally {
		clearTimeout(timeout);
		blocked.resolve();
		await Bun.sleep(0);
	}
	expect(f.events).toEqual([]);
});

test("concurrent operations keep independent lifecycle IDs", async () => {
	const f = await canvasActivityFixture();
	await Promise.all([f.execute(), f.execute()]);
	const events = f.events.filter(isCanvasAgentActivity);
	const starts = events.filter((event) => event.phase === "active");
	expect(new Set(starts.map((event) => event.operationId)).size).toBe(2);
	for (const start of starts)
		expect(
			events
				.filter((event) => event.operationId === start.operationId)
				.map((event) => event.phase),
		).toEqual(["active", "completed"]);
});

test("Agent Auth uses the verified owner's registered agent name", async () => {
	const f = await canvasActivityFixture();
	f.ports.agents = createTestAgentAdminRepository([
		{
			id: "agent",
			name: "Diagram helper",
			userId: f.userId,
			status: "active",
			mode: "delegated",
			hostId: "host",
			hostName: "Codex",
			hostStatus: "active",
			hostDefaultCapabilities: [],
			grants: [],
			lastUsedAt: null,
			createdAt: new Date(),
		},
	]);
	const executor = await createHaunterAgentCapabilityExecutor({
		getServer: async () => f.server,
	});
	await executor.executeDynamic({
		name: "read_canvas",
		principal: { agentId: "agent", userId: f.userId, transport: "agent-auth" },
		input: { workspaceId: f.workspaceId, canvasId: f.canvas.id },
	});
	expect(f.events[0]).toMatchObject({
		agentId: "agent",
		agentName: "Diagram helper",
		userId: f.userId,
	});
});
