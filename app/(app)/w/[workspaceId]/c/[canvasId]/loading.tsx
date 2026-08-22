import { Skeleton } from "@/components/ui/skeleton";

export default function CanvasLoading() {
	return (
		<div className="flex h-[calc(100svh-3rem)] min-h-96 flex-col">
			<div className="flex h-12 shrink-0 items-center px-4">
				<Skeleton className="h-6 w-48" />
			</div>
			<Skeleton className="min-h-0 flex-1 rounded-none" />
		</div>
	);
}
