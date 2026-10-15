import { Skeleton } from "@/components/ui/skeleton";

const TASK_SKELETON_ROWS = ["task-a", "task-b", "task-c", "task-d"];

/** Shared by route loading and task queries, including uncached filters. */
export function TaskListSkeleton({ compact = false }: { compact?: boolean }) {
	const rows = compact ? TASK_SKELETON_ROWS.slice(0, 2) : TASK_SKELETON_ROWS;

	return (
		<div role="status" aria-label="Loading tasks" aria-busy>
			<ul className="flex flex-col divide-y" aria-hidden>
				{rows.map((id) => (
					<li key={id} className="flex items-start gap-3 py-2">
						<Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
						<div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
							<div className="flex min-w-0 flex-1 flex-col">
								<Skeleton className="my-1 h-4 w-3/5" />
								<Skeleton className="my-0.5 h-3 w-24 max-w-full" />
							</div>
							<div className="flex items-center gap-1 sm:shrink-0">
								{compact ? null : <Skeleton className="h-5 w-24" />}
								<Skeleton className="h-5 w-16" />
							</div>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
