import { Skeleton } from "@/components/ui/skeleton";
import {
	WorkspaceScreen,
	WorkspaceScreenHeader,
} from "@/components/workspace-screen";

const TRASH_SKELETON_ROWS = ["trash-a", "trash-b", "trash-c", "trash-d"];

export default function Loading() {
	return (
		<WorkspaceScreen role="status" aria-label="Loading deleted pages" aria-busy>
			<WorkspaceScreenHeader
				title="Trash"
				description="Restore deleted pages or permanently remove them."
			/>
			<ul className="flex flex-col divide-y" aria-hidden>
				{TRASH_SKELETON_ROWS.map((id) => (
					<li key={id} className="@container py-4">
						<div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:gap-6">
							<div className="flex min-w-0 flex-1 items-start gap-3">
								<Skeleton className="mt-0.5 size-5 shrink-0 rounded-sm @2xl:size-4" />
								<div className="flex min-w-0 flex-1 flex-col">
									<Skeleton className="my-1 h-4 w-3/5" />
									<Skeleton className="my-1 h-4 w-40 max-w-full" />
								</div>
							</div>
							<div className="flex flex-wrap gap-2 pl-5 @2xl:shrink-0 @2xl:pl-0">
								<Skeleton className="h-8 w-24" />
								<Skeleton className="h-8 w-32" />
							</div>
						</div>
					</li>
				))}
			</ul>
		</WorkspaceScreen>
	);
}
