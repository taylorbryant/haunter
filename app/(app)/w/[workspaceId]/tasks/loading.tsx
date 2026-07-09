import { Skeleton } from "@/components/ui/skeleton";

const TASK_SKELETON_ROWS = ["task-a", "task-b", "task-c", "task-d"];

export default function Loading() {
	return (
		<div
			className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10"
			aria-hidden
		>
			<Skeleton className="h-7 w-20" />
			<div className="flex flex-col gap-4">
				<Skeleton className="h-7 w-24" />
				<div className="flex items-center gap-1">
					<Skeleton className="h-7 w-16" />
					<Skeleton className="h-7 w-24" />
					<Skeleton className="h-7 w-12" />
					<div className="mx-1 h-4 w-px bg-border" />
					<Skeleton className="h-7 w-20" />
					<Skeleton className="h-7 w-14" />
				</div>
				<ul className="flex flex-col divide-y">
					{TASK_SKELETON_ROWS.map((id) => (
						<li key={id} className="flex items-start gap-3 py-2">
							<Skeleton className="mt-0.5 size-4 rounded-sm" />
							<div className="flex min-w-0 flex-1 items-start gap-3">
								<div className="min-w-0 flex-1">
									<Skeleton className="h-5 w-3/5" />
									<Skeleton className="mt-1 h-3 w-32" />
								</div>
								<Skeleton className="h-6 w-28" />
								<Skeleton className="h-6 w-16" />
							</div>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
