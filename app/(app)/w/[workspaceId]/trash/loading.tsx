import { Skeleton } from "@/components/ui/skeleton";

const TRASH_SKELETON_ROWS = ["trash-a", "trash-b", "trash-c", "trash-d"];

export default function Loading() {
	return (
		<div
			className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10"
			aria-hidden
		>
			<div className="flex flex-col gap-1">
				<Skeleton className="h-7 w-20" />
				<Skeleton className="h-4 w-80 max-w-full" />
			</div>
			<ul className="flex flex-col divide-y">
				{TRASH_SKELETON_ROWS.map((id) => (
					<li key={id} className="flex items-center gap-3 py-2">
						<Skeleton className="size-4 rounded-sm" />
						<div className="min-w-0 flex-1">
							<Skeleton className="h-5 w-2/5" />
							<Skeleton className="mt-1 h-3 w-44" />
						</div>
						<Skeleton className="h-7 w-20" />
						<Skeleton className="h-7 w-28" />
					</li>
				))}
			</ul>
		</div>
	);
}
