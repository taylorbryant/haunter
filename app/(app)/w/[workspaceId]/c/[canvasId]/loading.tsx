import { Skeleton } from "@/components/ui/skeleton";

export default function CanvasLoading() {
	return (
		<div className="h-full min-h-96 border-border border-t">
			<Skeleton className="h-full rounded-none" />
		</div>
	);
}
