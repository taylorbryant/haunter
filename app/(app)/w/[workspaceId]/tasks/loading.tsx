import { Skeleton } from "@/components/ui/skeleton";
import {
	WorkspaceScreen,
	WorkspaceScreenHeader,
} from "@/components/workspace-screen";

const TASK_SKELETON_ROWS = ["task-a", "task-b", "task-c", "task-d"];

export default function Loading() {
	return (
		<WorkspaceScreen role="status" aria-label="Loading tasks" aria-busy>
			<WorkspaceScreenHeader
				title="Tasks"
				actions={<Skeleton className="h-8 w-24" aria-hidden />}
			/>
			<div className="flex flex-col gap-4" aria-hidden>
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
					<div className="flex items-center gap-1">
						<Skeleton className="h-7 w-14" />
						<Skeleton className="h-7 w-24" />
						<Skeleton className="h-7 w-10" />
					</div>
					<div className="flex items-center gap-1">
						<Skeleton className="h-7 w-20" />
						<Skeleton className="h-7 w-14" />
					</div>
				</div>
				<ul className="flex flex-col divide-y">
					{TASK_SKELETON_ROWS.map((id) => (
						<li key={id} className="flex items-start gap-3 py-2">
							<Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
							<div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
								<div className="flex min-w-0 flex-1 flex-col">
									<Skeleton className="my-1 h-4 w-3/5" />
									<Skeleton className="my-0.5 h-3 w-24 max-w-full" />
								</div>
								<div className="flex items-center gap-1 sm:shrink-0">
									<Skeleton className="h-5 w-24" />
									<Skeleton className="h-5 w-16" />
								</div>
							</div>
						</li>
					))}
				</ul>
			</div>
		</WorkspaceScreen>
	);
}
