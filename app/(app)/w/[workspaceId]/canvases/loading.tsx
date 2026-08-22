import { Skeleton } from "@/components/ui/skeleton";

export default function CanvasesLoading() {
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
			<div className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-2">
					<Skeleton className="h-7 w-28" />
					<Skeleton className="h-5 w-72 max-w-full" />
				</div>
				<Skeleton className="h-8 w-28" />
			</div>
			<div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border">
				{[0, 1, 2].map((item) => (
					<div key={item} className="flex items-center gap-3 p-4">
						<Skeleton className="size-4 shrink-0" />
						<div className="flex flex-1 flex-col gap-2">
							<Skeleton className="h-4 w-2/5" />
							<Skeleton className="h-4 w-1/4" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
