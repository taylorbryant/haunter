import { describe, expect, it } from "bun:test";
import {
	acknowledgePendingTaskAttributions,
	batchTaskAttributions,
	MAX_TASK_ATTRIBUTIONS_PER_MATERIALIZATION,
	recordPendingTaskAttributions,
	snapshotPendingTaskAttributions,
} from "@/features/documents/client/task-attribution";

function attribution(blockId: string, assignee: string) {
	return { blockId, assignee, operationId: crypto.randomUUID() };
}

describe("pending task attribution", () => {
	it("does not acknowledge a newer operation with an older request", () => {
		const pageId = crypto.randomUUID();
		const actorUserId = crypto.randomUUID();
		const first = attribution("task-1", "member-a");
		recordPendingTaskAttributions(pageId, actorUserId, [first]);
		const firstRequest = snapshotPendingTaskAttributions(pageId, actorUserId);

		const second = attribution("task-1", "member-b");
		recordPendingTaskAttributions(pageId, actorUserId, [second]);
		acknowledgePendingTaskAttributions(pageId, actorUserId, firstRequest);

		expect(snapshotPendingTaskAttributions(pageId, actorUserId)).toEqual([
			second,
		]);

		acknowledgePendingTaskAttributions(pageId, actorUserId, [second]);
		expect(snapshotPendingTaskAttributions(pageId, actorUserId)).toEqual([]);
	});

	it("does not acknowledge a newer operation with the same assignee", () => {
		const pageId = crypto.randomUUID();
		const actorUserId = crypto.randomUUID();
		const first = attribution("task-1", "member-a");
		recordPendingTaskAttributions(pageId, actorUserId, [first]);
		const firstRequest = snapshotPendingTaskAttributions(pageId, actorUserId);
		const second = attribution("task-1", "member-a");
		recordPendingTaskAttributions(pageId, actorUserId, [second]);

		acknowledgePendingTaskAttributions(pageId, actorUserId, firstRequest);
		expect(snapshotPendingTaskAttributions(pageId, actorUserId)).toEqual([
			second,
		]);
	});

	it("drops attribution when a local assignment is cleared", () => {
		const pageId = crypto.randomUUID();
		const actorUserId = crypto.randomUUID();
		recordPendingTaskAttributions(pageId, actorUserId, [
			attribution("task-1", "member-a"),
		]);
		recordPendingTaskAttributions(pageId, actorUserId, [
			{ blockId: "task-1", assignee: null, operationId: null },
		]);

		expect(snapshotPendingTaskAttributions(pageId, actorUserId)).toEqual([]);
	});

	it("isolates durable attribution retries by actor", () => {
		const pageId = crypto.randomUUID();
		const firstActor = crypto.randomUUID();
		const secondActor = crypto.randomUUID();
		const first = attribution("task-1", "member-a");
		const second = attribution("task-2", "member-b");
		recordPendingTaskAttributions(pageId, firstActor, [first]);
		recordPendingTaskAttributions(pageId, secondActor, [second]);

		expect(snapshotPendingTaskAttributions(pageId, firstActor)).toEqual([
			first,
		]);
		expect(snapshotPendingTaskAttributions(pageId, secondActor)).toEqual([
			second,
		]);

		acknowledgePendingTaskAttributions(pageId, firstActor, [first]);
		acknowledgePendingTaskAttributions(pageId, secondActor, [second]);
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
			const pending = attribution("task-1", "member-a");
			recordPendingTaskAttributions(pageId, actorUserId, [pending]);

			const stored = [...values.values()][0];
			expect(stored).toBe(
				JSON.stringify({
					"task-1": {
						assignee: pending.assignee,
						operationId: pending.operationId,
					},
				}),
			);
			expect(snapshotPendingTaskAttributions(pageId, actorUserId)).toEqual([
				pending,
			]);
			acknowledgePendingTaskAttributions(pageId, actorUserId, [pending]);
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
			(_, index) => attribution(`task-${index}`, `member-${index}`),
		);

		const batches = batchTaskAttributions(attributions);
		expect(batches.map((batch) => batch.length)).toEqual([100, 100, 1]);
		expect(batches.flat()).toEqual(attributions);
		expect(batchTaskAttributions([])).toEqual([[]]);
	});
});
