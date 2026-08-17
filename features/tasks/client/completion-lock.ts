export function createTaskWriteLock() {
	const taskTails = new Map<string, Promise<void>>();
	let pendingWriteCount = 0;
	const idleWaiters = new Set<() => void>();

	function notifyIdle() {
		if (pendingWriteCount !== 0) return;
		for (const resolve of idleWaiters) resolve();
		idleWaiters.clear();
	}

	async function run<T>(taskId: string, action: () => Promise<T>) {
		const previous = taskTails.get(taskId) ?? Promise.resolve();
		pendingWriteCount += 1;
		const result = previous.catch(() => undefined).then(action);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		taskTails.set(taskId, tail);
		try {
			return await result;
		} finally {
			pendingWriteCount -= 1;
			if (taskTails.get(taskId) === tail) taskTails.delete(taskId);
			notifyIdle();
		}
	}

	async function runMany<T>(taskIds: string[], action: () => Promise<T>) {
		const orderedTaskIds = [...new Set(taskIds)].sort();
		async function acquire(index: number): Promise<T> {
			const taskId = orderedTaskIds[index];
			if (taskId === undefined) return action();
			return run(taskId, () => acquire(index + 1));
		}
		return acquire(0);
	}

	return {
		hasPendingWrites() {
			return pendingWriteCount > 0;
		},
		isPending(taskId: string) {
			return taskTails.has(taskId);
		},
		whenIdle() {
			if (pendingWriteCount === 0) return Promise.resolve();
			return new Promise<void>((resolve) => idleWaiters.add(resolve));
		},
		run,
		runMany,
	};
}

export const taskWriteLock = createTaskWriteLock();
