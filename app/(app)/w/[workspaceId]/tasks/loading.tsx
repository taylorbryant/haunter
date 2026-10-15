import { Skeleton } from "@/components/ui/skeleton";
import {
	WorkspaceScreen,
	WorkspaceScreenHeader,
} from "@/components/workspace-screen";
import { TaskListSkeleton } from "@/features/tasks/components/task-list-skeleton";

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
				<TaskListSkeleton />
			</div>
		</WorkspaceScreen>
	);
}
