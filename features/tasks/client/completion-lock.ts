export function createTaskCompletionLock() {
	const pendingTaskIds = new Set<string>();

	return {
		isPending(taskId: string) {
			return pendingTaskIds.has(taskId);
		},
		async run<T>(taskId: string, action: () => Promise<T>) {
			if (pendingTaskIds.has(taskId)) {
				return { started: false as const };
			}
			pendingTaskIds.add(taskId);
			try {
				return { started: true as const, value: await action() };
			} finally {
				pendingTaskIds.delete(taskId);
			}
		},
	};
}
