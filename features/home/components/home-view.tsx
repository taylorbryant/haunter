"use client";

import { useQuery } from "@tanstack/react-query";
import { FileTextIcon, ShapesIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useDeviceTime } from "@/components/device-time-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCanvasNavigationQueryOptions } from "@/features/canvases/client/queries";
import {
	distinctRecentItems,
	formatHomeDate,
	getHomeUpcomingRange,
	HOME_PAGE_LIST_LIMIT,
	type HomeNavigationItem,
	mergeHomeNavigationItems,
} from "@/features/home/lib/home";
import { getPageNavigationQueryOptions } from "@/features/pages/client/queries";
import { formatViewedAt } from "@/features/pages/lib/format-viewed-at";
import { TaskList } from "@/features/tasks/components/task-list";

function HomeNavigationList({
	items,
	workspaceId,
	now,
	showViewedAt = false,
}: {
	items: HomeNavigationItem[];
	workspaceId: string;
	now: number;
	showViewedAt?: boolean;
}) {
	return (
		<ul className="flex list-none flex-col divide-y">
			{items.map((item) => (
				<li key={`${item.kind}:${item.id}`} className="text-base sm:text-sm">
					<Link
						href={
							item.kind === "page"
								? `/w/${workspaceId}/p/${item.id}`
								: `/w/${workspaceId}/c/${item.id}`
						}
						className="keyboard-focus-ring flex min-w-0 items-center gap-3 rounded-sm py-2 hover:bg-muted/50 [--keyboard-focus-ring-size:2px]"
					>
						<div className="flex size-5 shrink-0 items-center justify-center">
							{item.icon ??
								(item.kind === "canvas" ? (
									<ShapesIcon
										className="size-4 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
								) : (
									<FileTextIcon
										className="size-4 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
								))}
						</div>
						<p className="min-w-0 flex-1 truncate">
							{item.title || "Untitled"}
						</p>
						{showViewedAt && item.lastViewedAt ? (
							<p className="shrink-0 text-muted-foreground">
								{formatViewedAt(item.lastViewedAt, now)}
							</p>
						) : null}
					</Link>
				</li>
			))}
		</ul>
	);
}

export function HomeView({ workspaceId }: { workspaceId: string }) {
	const deviceTime = useDeviceTime();
	const [showAllFavorites, setShowAllFavorites] = useState(false);
	const pageNavigationQuery = useQuery(
		getPageNavigationQueryOptions(workspaceId),
	);
	const canvasNavigationQuery = useQuery(
		getCanvasNavigationQueryOptions(workspaceId),
	);
	const upcomingRange = deviceTime.ready
		? getHomeUpcomingRange(deviceTime.today)
		: null;
	const favorites = mergeHomeNavigationItems(
		pageNavigationQuery.data?.favorites ?? [],
		canvasNavigationQuery.data?.favorites ?? [],
		"favoritedAt",
	);
	const visibleFavorites = showAllFavorites
		? favorites
		: favorites.slice(0, HOME_PAGE_LIST_LIMIT);
	const recentItems = distinctRecentItems(
		favorites,
		mergeHomeNavigationItems(
			pageNavigationQuery.data?.recents ?? [],
			canvasNavigationQuery.data?.recents ?? [],
			"lastViewedAt",
		),
	);
	const navigationPending =
		!pageNavigationQuery.data &&
		!canvasNavigationQuery.data &&
		(pageNavigationQuery.isPending || canvasNavigationQuery.isPending);
	const navigationError =
		!pageNavigationQuery.data &&
		!canvasNavigationQuery.data &&
		pageNavigationQuery.isError &&
		canvasNavigationQuery.isError;

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-10">
			<header className="flex flex-col gap-1">
				<h1 className="text-balance font-heading font-semibold text-xl">
					Home
				</h1>
				{deviceTime.ready ? (
					<p className="text-pretty text-muted-foreground text-base sm:text-sm">
						{formatHomeDate(deviceTime.today)}
					</p>
				) : (
					<Skeleton className="h-5 w-44" aria-label="Loading local date" />
				)}
			</header>

			{deviceTime.ready && upcomingRange ? (
				<>
					<TaskList workspaceId={workspaceId} variant="today" />
					<TaskList
						workspaceId={workspaceId}
						variant="upcoming"
						upcomingStartDate={upcomingRange.start}
						upcomingEndDate={upcomingRange.end}
					/>
				</>
			) : (
				<section
					className="flex flex-col gap-8"
					aria-label="Loading device-local tasks"
				>
					<div className="flex flex-col gap-3">
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-4 w-16" />
						<Skeleton className="h-5 w-3/5" />
					</div>
					<div className="flex flex-col gap-3 border-t pt-6">
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-5 w-2/5" />
					</div>
				</section>
			)}

			{navigationPending ? (
				<section
					className="flex flex-col gap-3 border-t pt-6"
					aria-label="Loading favorites and recent items"
				>
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-5 w-2/5" />
					<Skeleton className="h-5 w-1/3" />
				</section>
			) : navigationError ? (
				<section
					className="flex flex-col gap-2 border-t pt-6"
					aria-labelledby="saved-items-heading"
				>
					<h2
						id="saved-items-heading"
						className="font-medium text-base sm:text-sm"
					>
						Workspace
					</h2>
					<div className="flex items-center gap-2 text-base sm:text-sm">
						<p className="text-pretty text-muted-foreground">
							Favorites and recent items could not be loaded.
						</p>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() =>
								void Promise.all([
									pageNavigationQuery.refetch(),
									canvasNavigationQuery.refetch(),
								])
							}
						>
							Retry
						</Button>
					</div>
				</section>
			) : favorites.length > 0 || recentItems.length > 0 ? (
				<div className="flex flex-col gap-6 border-t pt-6">
					{favorites.length > 0 ? (
						<section aria-labelledby="favorite-items-heading">
							<h2
								id="favorite-items-heading"
								className="font-medium text-base sm:text-sm"
							>
								Favorites
							</h2>
							<div className="mt-2">
								<HomeNavigationList
									items={visibleFavorites}
									workspaceId={workspaceId}
									now={deviceTime.timestamp}
								/>
							</div>
							{favorites.length > HOME_PAGE_LIST_LIMIT ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="mt-2"
									onClick={() => setShowAllFavorites((current) => !current)}
								>
									{showAllFavorites ? "Show less" : "Show more"}
								</Button>
							) : null}
						</section>
					) : null}

					{recentItems.length > 0 ? (
						<section aria-labelledby="recent-items-heading">
							<h2
								id="recent-items-heading"
								className="font-medium text-base sm:text-sm"
							>
								Recently viewed
							</h2>
							<div className="mt-2">
								<HomeNavigationList
									items={recentItems}
									workspaceId={workspaceId}
									now={deviceTime.timestamp}
									showViewedAt
								/>
							</div>
						</section>
					) : null}
				</div>
			) : null}
		</div>
	);
}
