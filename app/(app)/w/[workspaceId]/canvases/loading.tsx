import { Skeleton } from "@/components/ui/skeleton";
import {
	WorkspaceScreen,
	WorkspaceScreenHeader,
} from "@/components/workspace-screen";

export default function CanvasesLoading() {
	return (
		<WorkspaceScreen role="status" aria-label="Loading canvases" aria-busy>
			<WorkspaceScreenHeader
				title="Canvases"
				description="Explore ideas, sketch concepts, and map how things connect."
				actions={<Skeleton className="h-8 w-28" aria-hidden />}
			/>
			<ul className="list-none divide-y divide-border" aria-hidden>
				{["canvas-a", "canvas-b", "canvas-c"].map((id) => (
					<li key={id} className="@container py-3">
						<div className="flex min-w-0 flex-col gap-1 @md:flex-row @md:items-center @md:gap-2">
							<div className="-ml-2 flex min-w-0 flex-1 items-start gap-3 p-2">
								<Skeleton className="mt-1 size-4 shrink-0" />
								<div className="flex min-w-0 flex-1 flex-col">
									<Skeleton className="my-1 h-4 w-3/5" />
									<Skeleton className="my-1 h-4 w-36 max-w-full sm:h-3" />
								</div>
							</div>
							<div className="flex items-center gap-2 pl-5 @md:shrink-0 @md:pl-0">
								<Skeleton className="size-7" />
								<Skeleton className="size-7" />
							</div>
						</div>
					</li>
				))}
			</ul>
		</WorkspaceScreen>
	);
}
