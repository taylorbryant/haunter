export function createTaskWriteLock() {
	const taskTails = new Map<string, Promise<void>>();
	let pendingWriteCount = 0;
	const idleWaiters = new Set<() => void>();

	function notifyIdle() {
		if (pendingWriteCount !== 0) return;
		for (const resolve of idleWaiters) resolve();
		idleWaiters.clear();
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
		async run<T>(taskId: string, action: () => Promise<T>) {
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
		},
	};
}

export const taskWriteLock = createTaskWriteLock();
