import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
	estimatedWorkspaceServerTime,
	readWorkspaceEventClock,
	type WorkspaceEventClock,
} from "@/features/collab/client/event-clock";
import { bindWorkspaceEvents } from "@/features/collab/client/sse";
import {
	createWorkspaceTaskEvent,
	type WorkspaceEvent,
} from "@/features/collab/workspace-events";

class TestEventSource extends EventTarget {
	static instances: TestEventSource[] = [];
	static onCreated: (() => void) | undefined;
	closed = false;
	constructor(readonly url: string) {
		super();
		TestEventSource.instances.push(this);
		TestEventSource.onCreated?.();
	}
	close() {
		this.closed = true;
	}
	emit(type: string, data: unknown) {
		this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
	}
}

let restore: (() => void) | undefined;
let unbind: (() => void) | undefined;
beforeEach(() => {
	const original = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
	Object.defineProperty(globalThis, "EventSource", {
		configurable: true,
		value: TestEventSource,
	});
	restore = () => {
		if (original) Object.defineProperty(globalThis, "EventSource", original);
		else Reflect.deleteProperty(globalThis, "EventSource");
	};
	TestEventSource.instances = [];
	TestEventSource.onCreated = undefined;
});
afterEach(() => {
	unbind?.();
	unbind = undefined;
	restore?.();
});

test("clock references use only server time and monotonic elapsed time", () => {
	const clock = readWorkspaceEventClock({ serverTime: 1_000_000 }, 500);
	expect(clock).toEqual({ serverTime: 1_000_000, receivedAt: 500 });
	if (!clock) throw new Error("Expected a clock reference");
	expect(estimatedWorkspaceServerTime(clock, 1_500)).toBe(1_001_000);
	for (const invalid of [
		null,
		{},
		{ serverTime: "1000" },
		{ serverTime: NaN },
		{ serverTime: Infinity },
		{ serverTime: -1 },
		{ serverTime: 9e15 },
	]) {
		expect(readWorkspaceEventClock(invalid, 500)).toBeNull();
	}
});

test("a connection supplies its own reference and resets it on reconnect", async () => {
	const now = spyOn(performance, "now").mockReturnValue(100);
	const events: Array<{
		event: WorkspaceEvent;
		clock: WorkspaceEventClock | null;
	}> = [];
	let connected = 0;
	let errors = 0;
	const event = createWorkspaceTaskEvent({
		workspaceId: "workspace",
		taskId: "task",
	});
	try {
		unbind = bindWorkspaceEvents("workspace", {
			onEvent(event, clock) {
				events.push({ event, clock });
			},
			onConnected() {
				connected += 1;
			},
			onConnectionError() {
				errors += 1;
			},
		});
		const first = TestEventSource.instances[0];
		if (!first) throw new Error("Missing initial connection");
		first.emit("connected", { serverTime: 1_000_000 });
		first.emit("workspace-event", event);
		expect(events.at(-1)?.clock).toEqual({
			serverTime: 1_000_000,
			receivedAt: 100,
		});
		const reconnect = Promise.withResolvers<void>();
		TestEventSource.onCreated = () => reconnect.resolve();
		first.emit("error", {});
		expect(first.closed).toBe(true);
		await reconnect.promise;
		const second = TestEventSource.instances[1];
		if (!second) throw new Error("Missing replacement connection");
		second.emit("workspace-event", event);
		expect(events.at(-1)?.clock).toBeNull();
		now.mockReturnValue(2_000);
		second.emit("connected", { serverTime: 2_000_000 });
		second.emit("workspace-event", event);
		expect(events.at(-1)?.clock).toEqual({
			serverTime: 2_000_000,
			receivedAt: 2_000,
		});
		const count = events.length;
		first.emit("connected", { serverTime: 0 });
		first.emit("workspace-event", event);
		first.emit("error", {});
		expect(events).toHaveLength(count);
		expect(second.closed).toBe(false);
		expect(connected).toBe(2);
		expect(errors).toBe(1);
		unbind();
		second.emit("workspace-event", event);
		expect(events).toHaveLength(count);
	} finally {
		now.mockRestore();
	}
});

test("legacy or invalid clock references preserve ordinary workspace events without guessing browser time", () => {
	const clocks: Array<WorkspaceEventClock | null> = [];
	let connected = 0;
	unbind = bindWorkspaceEvents("workspace", {
		onEvent(_event, clock) {
			clocks.push(clock);
		},
		onConnected() {
			connected += 1;
		},
	});
	const source = TestEventSource.instances[0];
	if (!source) throw new Error("Missing connection");
	const event = createWorkspaceTaskEvent({
		workspaceId: "workspace",
		taskId: "task",
	});
	for (const data of [{}, { serverTime: "invalid" }]) {
		source.emit("connected", data);
		source.emit("workspace-event", event);
	}
	source.dispatchEvent(new MessageEvent("connected", { data: "invalid JSON" }));
	source.emit("workspace-event", event);
	expect(clocks).toEqual([null, null, null]);
	expect(connected).toBe(3);
});
