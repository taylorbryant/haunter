import { Skeleton } from "@/components/ui/skeleton";

export default function CanvasLoading() {
	return (
		<div className="h-[calc(100svh-3rem)] min-h-96 border-border border-t">
			<Skeleton className="h-full rounded-none" />
		</div>
	);
}
