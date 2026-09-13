import { expect, test } from "bun:test";
import { createTaskWriteLock } from "@/features/tasks/client/completion-lock";

test("task write observers see start and settlement without controlling writes", async () => {
	const lock = createTaskWriteLock();
	const changes: boolean[] = [];
	const stopBroken = lock.subscribe(() => {
		throw new Error("observer failed");
	});
	const stop = lock.subscribe(() => changes.push(lock.hasPendingWrites()));
	await expect(
		lock.run("task_1", async () => {
			throw new Error("write failed");
		}),
	).rejects.toThrow("write failed");
	expect(changes).toEqual([true, false]);
	expect(lock.hasPendingWrites()).toBe(false);
	stop();
	stopBroken();
	await lock.run("task_1", async () => {});
	expect(changes).toEqual([true, false]);
});

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
