import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-10">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-7 w-20" />
				<Skeleton className="h-4 w-36" />
			</div>
			<div className="flex flex-col gap-4">
				<Skeleton className="h-9 w-full" />
				<div className="flex flex-col gap-2">
					<Skeleton className="h-4 w-16" />
					{["first", "second", "third"].map((key) => (
						<div key={key} className="flex items-center gap-3 border-b py-2">
							<Skeleton className="size-4 rounded-sm" />
							<Skeleton className="h-5 w-3/5" />
						</div>
					))}
				</div>
			</div>
			<div className="border-t pt-6">
				<Skeleton className="h-4 w-28" />
				<div className="mt-4 flex flex-col gap-4">
					<Skeleton className="h-5 w-2/5" />
					<Skeleton className="h-5 w-1/3" />
				</div>
			</div>
		</div>
	);
}
