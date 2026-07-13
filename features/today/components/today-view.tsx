"use client";

import { useQuery } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { notificationSettingsQueryOptions } from "@/features/notifications/client/queries";
import { listPagesQueryOptions } from "@/features/pages/client/queries";
import { formatEditedAt } from "@/features/pages/lib/format-edited-at";
import { TaskList } from "@/features/tasks/components/task-list";
import { formatTodayDate, selectRecentPages } from "@/features/today/lib/today";
import { localDateAndTime } from "@/lib/timezone";

export function TodayView({
	workspaceId,
	initialNow,
	initialTimezone,
}: {
	workspaceId: string;
	initialNow: number;
	initialTimezone: string;
}) {
	const [now, setNow] = useState(initialNow);
	const settingsQuery = useQuery(notificationSettingsQueryOptions());
	const pagesQuery = useQuery(listPagesQueryOptions(workspaceId));
	const timezone = settingsQuery.data?.timezone ?? initialTimezone;
	const localNow = localDateAndTime(new Date(now), timezone);
	const todayDate = localNow.date;
	const recentPages = selectRecentPages(pagesQuery.data?.items ?? []);

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-10">
			<header>
				<h1 className="font-heading font-semibold text-xl">Today</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					{formatTodayDate(todayDate)}
				</p>
			</header>

			<TaskList
				workspaceId={workspaceId}
				variant="today"
				todayDate={todayDate}
				currentTime={localNow.time}
			/>

			{pagesQuery.isError ? (
				<section
					className="border-t pt-6"
					aria-labelledby="recent-pages-heading"
				>
					<h2 id="recent-pages-heading" className="font-medium text-sm">
						Recently edited
					</h2>
					<div className="mt-2 flex items-center gap-2 text-sm">
						<p className="text-muted-foreground">
							Recent pages could not be loaded.
						</p>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => pagesQuery.refetch()}
						>
							Retry
						</Button>
					</div>
				</section>
			) : recentPages.length > 0 ? (
				<section
					className="border-t pt-6"
					aria-labelledby="recent-pages-heading"
				>
					<h2 id="recent-pages-heading" className="font-medium text-sm">
						Recently edited
					</h2>
					<ul className="mt-2 flex flex-col divide-y">
						{recentPages.map((page) => (
							<li key={page.id}>
								<Link
									href={`/w/${workspaceId}/p/${page.id}`}
									className="keyboard-focus-ring flex min-w-0 items-center gap-3 rounded-sm py-2 text-sm hover:bg-muted/50 [--keyboard-focus-ring-size:2px]"
								>
									<span className="flex size-5 shrink-0 items-center justify-center text-base">
										{page.icon ?? (
											<FileTextIcon
												className="size-4 text-muted-foreground"
												aria-hidden="true"
											/>
										)}
									</span>
									<span className="min-w-0 flex-1 truncate">
										{page.title || "Untitled"}
									</span>
									<span className="shrink-0 text-muted-foreground text-xs">
										{formatEditedAt(page.updatedAt, now)}
									</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
