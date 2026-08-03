import { describe, expect, it } from "bun:test";
import {
	acknowledgePendingTaskAttributions,
	batchTaskAttributions,
	MAX_TASK_ATTRIBUTIONS_PER_MATERIALIZATION,
	recordPendingTaskAttributions,
	snapshotPendingTaskAttributions,
} from "@/features/documents/client/task-attribution";

describe("pending task attribution", () => {
	it("does not acknowledge a newer operation with an older request", () => {
		const pageId = crypto.randomUUID();
		const actorUserId = crypto.randomUUID();
		recordPendingTaskAttributions(pageId, actorUserId, [
			{ blockId: "task-1", assignee: "member-a" },
		]);
		const firstRequest = snapshotPendingTaskAttributions(pageId, actorUserId);

		recordPendingTaskAttributions(pageId, actorUserId, [
			{ blockId: "task-1", assignee: "member-b" },
		]);
		acknowledgePendingTaskAttributions(pageId, actorUserId, firstRequest);

		expect(snapshotPendingTaskAttributions(pageId, actorUserId)).toEqual([
			{ blockId: "task-1", assignee: "member-b" },
		]);

		acknowledgePendingTaskAttributions(pageId, actorUserId, [
			{ blockId: "task-1", assignee: "member-b" },
		]);
		expect(snapshotPendingTaskAttributions(pageId, actorUserId)).toEqual([]);
	});

	it("drops attribution when a local assignment is cleared", () => {
		const pageId = crypto.randomUUID();
		const actorUserId = crypto.randomUUID();
		recordPendingTaskAttributions(pageId, actorUserId, [
			{ blockId: "task-1", assignee: "member-a" },
		]);
		recordPendingTaskAttributions(pageId, actorUserId, [
			{ blockId: "task-1", assignee: null },
		]);

		expect(snapshotPendingTaskAttributions(pageId, actorUserId)).toEqual([]);
	});

	it("isolates durable attribution retries by actor", () => {
		const pageId = crypto.randomUUID();
		const firstActor = crypto.randomUUID();
		const secondActor = crypto.randomUUID();
		recordPendingTaskAttributions(pageId, firstActor, [
			{ blockId: "task-1", assignee: "member-a" },
		]);
		recordPendingTaskAttributions(pageId, secondActor, [
			{ blockId: "task-2", assignee: "member-b" },
		]);

		expect(snapshotPendingTaskAttributions(pageId, firstActor)).toEqual([
			{ blockId: "task-1", assignee: "member-a" },
		]);
		expect(snapshotPendingTaskAttributions(pageId, secondActor)).toEqual([
			{ blockId: "task-2", assignee: "member-b" },
		]);

		acknowledgePendingTaskAttributions(pageId, firstActor, [
			{ blockId: "task-1", assignee: "member-a" },
		]);
		acknowledgePendingTaskAttributions(pageId, secondActor, [
			{ blockId: "task-2", assignee: "member-b" },
		]);
	});

	it("persists attribution outside component memory for a later retry", () => {
		const values = new Map<string, string>();
		const storage: Storage = {
			get length() {
				return values.size;
			},
			clear() {
				values.clear();
			},
			getItem(key) {
				return values.get(key) ?? null;
			},
			key(index) {
				return [...values.keys()][index] ?? null;
			},
			removeItem(key) {
				values.delete(key);
			},
			setItem(key, value) {
				values.set(key, value);
			},
		};
		const previousWindow = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { localStorage: storage },
		});
		try {
			const pageId = crypto.randomUUID();
			const actorUserId = crypto.randomUUID();
			recordPendingTaskAttributions(pageId, actorUserId, [
				{ blockId: "task-1", assignee: "member-a" },
			]);

			const stored = [...values.values()][0];
			expect(stored).toBe(JSON.stringify({ "task-1": "member-a" }));
			// Reading the browser store on every retry models a fresh component or tab,
			// rather than relying on this module's in-memory map.
			expect(snapshotPendingTaskAttributions(pageId, actorUserId)).toEqual([
				{ blockId: "task-1", assignee: "member-a" },
			]);
			acknowledgePendingTaskAttributions(pageId, actorUserId, [
				{ blockId: "task-1", assignee: "member-a" },
			]);
			expect(values.size).toBe(0);
		} finally {
			if (previousWindow) {
				Object.defineProperty(globalThis, "window", previousWindow);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
		}
	});

	it("batches large attribution sets within the server request limit", () => {
		const attributions = Array.from(
			{ length: MAX_TASK_ATTRIBUTIONS_PER_MATERIALIZATION * 2 + 1 },
			(_, index) => ({
				blockId: `task-${index}`,
				assignee: `member-${index}`,
			}),
		);

		const batches = batchTaskAttributions(attributions);
		expect(batches.map((batch) => batch.length)).toEqual([100, 100, 1]);
		expect(batches.flat()).toEqual(attributions);
		expect(batchTaskAttributions([])).toEqual([[]]);
	});
});
