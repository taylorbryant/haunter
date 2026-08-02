import { expect, test } from "bun:test";
import { createTaskWriteLock } from "@/features/tasks/client/completion-lock";

test("task write lock queues same-task requests in user order", async () => {
	const lock = createTaskWriteLock();
	const calls: string[] = [];
	let releaseFirst: (() => void) | undefined;
	const first = lock.run("task_1", async () => {
		calls.push("complete");
		await new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
	});

	expect(lock.isPending("task_1")).toBe(true);
	const overlapping = lock.run("task_1", async () => {
		calls.push("reopen");
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(calls).toEqual(["complete"]);

	releaseFirst?.();
	await first;
	await overlapping;
	expect(calls).toEqual(["complete", "reopen"]);
	expect(lock.isPending("task_1")).toBe(false);
});

test("task write lock reports idle only after every task write settles", async () => {
	const lock = createTaskWriteLock();
	let releaseFirst: (() => void) | undefined;
	let releaseSecond: (() => void) | undefined;
	const first = lock.run(
		"task_1",
		() =>
			new Promise<void>((resolve) => {
				releaseFirst = resolve;
			}),
	);
	const second = lock.run(
		"task_2",
		() =>
			new Promise<void>((resolve) => {
				releaseSecond = resolve;
			}),
	);
	let idle = false;
	const waitForIdle = lock.whenIdle().then(() => {
		idle = true;
	});
	await new Promise((resolve) => setTimeout(resolve, 0));

	releaseFirst?.();
	await first;
	await Promise.resolve();
	expect(idle).toBe(false);

	releaseSecond?.();
	await second;
	await waitForIdle;
	expect(idle).toBe(true);
});
