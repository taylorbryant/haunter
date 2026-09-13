import type { Query, QueryClient, QueryFilters } from "@tanstack/react-query";
import { getBrowserSessionRecovery } from "@/client/session-recovery";
import { taskWriteBlocksQuery } from "./write-state";

const queued = new WeakMap<Query, Promise<void>>();

/** Local refresh requests share the task policy used by broadcasts and polling. */
export function refreshAfterTaskWrites(
	queryClient: QueryClient,
	filters: readonly QueryFilters[],
): Promise<void> {
	const cache = queryClient.getQueryCache();
	const queries = new Set(filters.flatMap((filter) => cache.findAll(filter)));
	return Promise.all(
		[...queries].map((query) => {
			const existing = queued.get(query);
			if (existing) return existing;
			const recovery = getBrowserSessionRecovery();
			const epoch = recovery?.epoch;
			let resolve!: () => void;
			const result = new Promise<void>((done) => {
				resolve = done;
			});
			queued.set(query, result);
			let scheduled = false;
			let disposed = false;
			const stop = () => {
				disposed = true;
				stopMutations();
				stopQueries();
				queued.delete(query);
			};
			const flush = () => {
				if (scheduled || disposed) return;
				scheduled = true;
				queueMicrotask(() => {
					scheduled = false;
					if (disposed) return;
					if (
						cache.get(query.queryHash) !== query ||
						getBrowserSessionRecovery() !== recovery ||
						recovery?.epoch !== epoch
					) {
						stop();
						resolve();
						return;
					}
					if (
						query.state.fetchStatus !== "idle" ||
						taskWriteBlocksQuery(queryClient, query)
					)
						return;
					// Remove before fetching: a later write must be able to request a
					// follow-up refresh even if this request is already in flight.
					stop();
					void queryClient
						.invalidateQueries(
							{ predicate: (candidate) => candidate === query },
							{ cancelRefetch: false },
						)
						.then(resolve, resolve);
				});
			};
			const stopMutations = queryClient.getMutationCache().subscribe(flush);
			const stopQueries = cache.subscribe(flush);
			flush();
			return result;
		}),
	).then(() => {});
}
