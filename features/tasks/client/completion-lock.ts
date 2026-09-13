export function createTaskWriteLock() {
	const taskTails = new Map<string, Promise<void>>();
	let pendingWriteCount = 0;
	const idleWaiters = new Set<() => void>();
	const listeners = new Set<() => void>();
	function notify() {
		for (const listener of listeners) {
			try {
				listener();
			} catch {
				// A refresh observer must not interrupt a write or strand its lock.
			}
		}
	}

	function notifyIdle() {
		if (pendingWriteCount !== 0) return;
		for (const resolve of idleWaiters) resolve();
		idleWaiters.clear();
	}

	return {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
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
			notify();
			try {
				return await result;
			} finally {
				pendingWriteCount -= 1;
				if (taskTails.get(taskId) === tail) taskTails.delete(taskId);
				notifyIdle();
				notify();
			}
		},
	};
}

export const taskWriteLock = createTaskWriteLock();
