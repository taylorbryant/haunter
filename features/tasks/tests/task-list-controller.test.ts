import { describe, expect, test } from "bun:test";
import { runOptimisticTaskWrite } from "@/features/tasks/client/task-list-controller";

function pendingHarness() {
	let pending = new Set<string>();
	return {
		get value() {
			return pending;
		},
		update(update: (current: Set<string>) => Set<string>) {
			pending = update(pending);
		},
	};
}

describe("task list optimistic write controller", () => {
	test("marks a task pending for the whole write and clears it afterward", async () => {
		const pending = pendingHarness();
		const states: boolean[] = [];

		const saved = await runOptimisticTaskWrite({
			taskId: "task_pending",
			setPendingTaskIds: pending.update,
			optimistic: async () => {
				states.push(pending.value.has("task_pending"));
				return "snapshot";
			},
			commit: async () => {
				states.push(pending.value.has("task_pending"));
			},
			rollback: () => {},
			onError: () => {},
		});

		expect(saved).toBe(true);
		expect(states).toEqual([true, true]);
		expect(pending.value.has("task_pending")).toBe(false);
	});

	test("rolls back only the failed write snapshot", async () => {
		const pending = pendingHarness();
		const snapshots: string[] = [];
		const errors: unknown[] = [];

		const saved = await runOptimisticTaskWrite({
			taskId: "task_failure",
			setPendingTaskIds: pending.update,
			optimistic: async () => "task_failure_before",
			commit: async () => {
				throw new Error("network failed");
			},
			rollback: (snapshot) => snapshots.push(snapshot),
			onError: (error) => errors.push(error),
		});

		expect(saved).toBe(false);
		expect(snapshots).toEqual(["task_failure_before"]);
		expect(errors).toHaveLength(1);
		expect(pending.value.size).toBe(0);
	});

	test("rolls back even when an optimistic operation has no return value", async () => {
		const pending = pendingHarness();
		let rolledBack = false;

		await runOptimisticTaskWrite({
			taskId: "task_void_snapshot",
			setPendingTaskIds: pending.update,
			optimistic: async () => undefined,
			commit: async () => {
				throw new Error("network failed");
			},
			rollback: () => {
				rolledBack = true;
			},
			onError: () => {},
		});

		expect(rolledBack).toBe(true);
	});

	test("serializes overlapping writes for one task", async () => {
		const pending = pendingHarness();
		const order: string[] = [];
		let releaseFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const options = {
			taskId: "task_serialized",
			setPendingTaskIds: pending.update,
			rollback: () => {},
			onError: () => {},
		};

		const first = runOptimisticTaskWrite({
			...options,
			optimistic: async () => {
				order.push("first optimistic");
				return null;
			},
			commit: async () => {
				await firstGate;
				order.push("first committed");
			},
		});
		const second = runOptimisticTaskWrite({
			...options,
			optimistic: async () => {
				order.push("second optimistic");
				return null;
			},
			commit: async () => {
				order.push("second committed");
			},
		});

		await Bun.sleep(0);
		expect(order).toEqual(["first optimistic"]);
		releaseFirst?.();
		await Promise.all([first, second]);
		expect(order).toEqual([
			"first optimistic",
			"first committed",
			"second optimistic",
			"second committed",
		]);
	});
});
