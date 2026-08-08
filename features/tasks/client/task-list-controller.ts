import { taskWriteLock } from "@/features/tasks/client/completion-lock";

export type PendingTaskUpdater = (
	update: (current: Set<string>) => Set<string>,
) => void;

function updatePendingTask(
	setPendingTaskIds: PendingTaskUpdater,
	taskId: string,
	pending: boolean,
) {
	setPendingTaskIds((current) => {
		const next = new Set(current);
		if (pending) next.add(taskId);
		else next.delete(taskId);
		return next;
	});
}

export async function runOptimisticTaskWrite<TSnapshot>({
	taskId,
	setPendingTaskIds,
	optimistic,
	commit,
	rollback,
	onError,
}: {
	taskId: string;
	setPendingTaskIds: PendingTaskUpdater;
	optimistic: () => Promise<TSnapshot>;
	commit: () => Promise<unknown>;
	rollback: (snapshot: TSnapshot) => void;
	onError: (error: unknown) => void;
}): Promise<boolean> {
	return taskWriteLock.run(taskId, async () => {
		updatePendingTask(setPendingTaskIds, taskId, true);
		let snapshot: { captured: false } | { captured: true; value: TSnapshot } = {
			captured: false,
		};
		try {
			snapshot = { captured: true, value: await optimistic() };
			await commit();
			return true;
		} catch (error) {
			if (snapshot.captured) rollback(snapshot.value);
			onError(error);
			return false;
		} finally {
			updatePendingTask(setPendingTaskIds, taskId, false);
		}
	});
}
