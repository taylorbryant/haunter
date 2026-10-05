import type { Mutation, QueryClient } from "@tanstack/react-query";
import { TASK_WRITE_KEY, taskWriteIdentity } from "./write-state";

/** Do not release an embedded workspace's credential while a task write is in flight. */
export function waitForTaskWrites(
	queryClient: QueryClient,
	workspaceId: string,
	timeoutMs = 4500,
): Promise<boolean> {
	const cache = queryClient.getMutationCache();
	const writes = () =>
		cache.findAll({
			mutationKey: TASK_WRITE_KEY,
			predicate: (mutation) =>
				taskWriteIdentity(mutation)?.workspaceId === workspaceId,
		});
	const tracked = new Set<Mutation>(
		writes().filter((mutation) => mutation.state.status === "pending"),
	);
	if (!tracked.size) return Promise.resolve(true);
	return new Promise((resolve) => {
		const finish = (saved: boolean) => {
			clearTimeout(timer);
			unsubscribe();
			resolve(saved);
		};
		const check = () => {
			for (const mutation of writes())
				if (mutation.state.status === "pending") tracked.add(mutation);
			if ([...tracked].some((mutation) => mutation.state.status === "pending"))
				return;
			finish(
				[...tracked].every((mutation) => mutation.state.status === "success"),
			);
		};
		const unsubscribe = cache.subscribe(check);
		const timer = setTimeout(() => finish(false), timeoutMs);
		check();
	});
}
