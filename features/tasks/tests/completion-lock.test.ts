import { expect, test } from "bun:test";
import { createTaskCompletionLock } from "@/features/tasks/client/completion-lock";

test("completion lock prevents same-task requests from running out of order", async () => {
	const lock = createTaskCompletionLock();
	const calls: string[] = [];
	let releaseFirst: (() => void) | undefined;
	const first = lock.run("task_1", async () => {
		calls.push("complete");
		await new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
	});

	expect(lock.isPending("task_1")).toBe(true);
	const overlapping = await lock.run("task_1", async () => {
		calls.push("reopen");
	});
	expect(overlapping.started).toBe(false);
	expect(calls).toEqual(["complete"]);

	releaseFirst?.();
	await first;
	const afterSettlement = await lock.run("task_1", async () => {
		calls.push("reopen");
	});
	expect(afterSettlement.started).toBe(true);
	expect(calls).toEqual(["complete", "reopen"]);
});
