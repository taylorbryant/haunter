import { Skeleton } from "@/components/ui/skeleton";

const TRASH_SKELETON_ROWS = ["trash-a", "trash-b", "trash-c", "trash-d"];

export default function Loading() {
	return (
		<div
			className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:gap-6 sm:px-6 sm:py-10"
			aria-hidden
		>
			<div className="flex flex-col gap-2">
				<Skeleton className="h-7 w-20" />
				<Skeleton className="h-4 w-80 max-w-full" />
			</div>
			<ul className="flex flex-col divide-y">
				{TRASH_SKELETON_ROWS.map((id) => (
					<li key={id} className="@container py-4">
						<div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:gap-6">
							<div className="flex min-w-0 flex-1 items-start gap-3">
								<Skeleton className="mt-0.5 size-5 shrink-0 rounded-sm @2xl:size-4" />
								<div className="min-w-0 flex-1">
									<Skeleton className="h-6 w-3/5" />
									<Skeleton className="mt-1 h-5 w-40 max-w-full" />
								</div>
							</div>
							<div className="flex gap-2 @2xl:shrink-0">
								<Skeleton className="h-12 flex-1 @2xl:h-8 @2xl:w-24 @2xl:flex-none pointer-coarse:min-h-12" />
								<Skeleton className="h-12 flex-1 @2xl:h-8 @2xl:w-32 @2xl:flex-none pointer-coarse:min-h-12" />
							</div>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
