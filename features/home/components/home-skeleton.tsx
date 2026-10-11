import { Skeleton } from "@/components/ui/skeleton";
import {
	WorkspaceScreen,
	WorkspaceScreenHeader,
} from "@/components/workspace-screen";

function HomeTaskRowsSkeleton() {
	return (
		<ul className="flex flex-col divide-y" aria-hidden>
			{["first", "second"].map((id) => (
				<li key={id} className="flex items-start gap-3 py-2">
					<Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
					<div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
						<div className="flex min-w-0 flex-1 flex-col">
							<Skeleton className="my-1 h-4 w-3/5" />
							<Skeleton className="my-0.5 h-3 w-24 max-w-full" />
						</div>
						<Skeleton className="h-5 w-16 shrink-0" />
					</div>
				</li>
			))}
		</ul>
	);
}

/** Shared by route loading and Home's device-time initialization. */
export function HomeTasksSkeleton() {
	return (
		<>
			<section
				className="flex flex-col gap-4"
				aria-label="Loading today's tasks"
				aria-busy
			>
				<div className="border-b py-2" aria-hidden>
					<Skeleton className="h-6 w-56 max-w-full" />
				</div>
				<div>
					<h2 className="mb-1 font-medium text-base sm:text-sm">Today</h2>
					<HomeTaskRowsSkeleton />
				</div>
			</section>
			<section
				className="border-t pt-6"
				aria-label="Loading upcoming tasks"
				aria-busy
			>
				<h2 className="font-medium text-base sm:text-sm">Coming up</h2>
				<div className="mt-2">
					<Skeleton className="h-6 w-24 sm:h-5" aria-hidden />
					<HomeTaskRowsSkeleton />
				</div>
			</section>
		</>
	);
}

/** Shared by route loading and Home's navigation query. */
export function HomeNavigationSkeleton() {
	return (
		<section
			className="flex flex-col gap-6 border-t pt-6"
			aria-label="Loading favorites and recent items"
			aria-busy
		>
			{["Favorites", "Recently viewed"].map((title) => (
				<div key={title}>
					<h2 className="font-medium text-base sm:text-sm">{title}</h2>
					<ul className="mt-2 flex list-none flex-col divide-y" aria-hidden>
						{["first", "second"].map((id) => (
							<li key={id} className="flex items-center gap-3 py-2">
								<Skeleton className="size-5 shrink-0" />
								<Skeleton className="h-6 w-2/5 sm:h-5" />
							</li>
						))}
					</ul>
				</div>
			))}
		</section>
	);
}

export function HomeSkeleton() {
	return (
		<WorkspaceScreen
			className="gap-8 sm:gap-10"
			role="status"
			aria-label="Loading Home"
			aria-busy
		>
			<WorkspaceScreenHeader
				title="Home"
				description={<Skeleton className="h-6 w-44" aria-hidden />}
			/>
			<HomeTasksSkeleton />
			<HomeNavigationSkeleton />
		</WorkspaceScreen>
	);
}
