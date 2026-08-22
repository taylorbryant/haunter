import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { cookies } from "next/headers";
import { makeQueryClient } from "@/client";
import { getCanvasNavigationQueryOptions } from "@/features/canvases/client/queries";
import { getCanvasNavigationUseCase } from "@/features/canvases/use-cases";
import { HomeView } from "@/features/home/components/home-view";
import { getHomeUpcomingRange } from "@/features/home/lib/home";
import { getPageNavigationQueryOptions } from "@/features/pages/client/queries";
import { getPageNavigationUseCase } from "@/features/pages/use-cases";
import { listTasksQueryOptions } from "@/features/tasks/client/queries";
import { UPCOMING_TASK_SUMMARY_LIMIT } from "@/features/tasks/lib/group-tasks-by-due-date";
import { listTasksUseCase } from "@/features/tasks/use-cases";
import {
	DEVICE_TIMEZONE_COOKIE_NAME,
	readDeviceTimezoneCookie,
} from "@/lib/device-timezone";
import {
	getAppRequestContext,
	serverUseCaseQueryOptions,
} from "@/lib/server-react-query";
import { localDateAndTime } from "@/lib/timezone";

const TODAY_TASK_LIMIT = 200;

export default async function HomePage({
	params,
}: {
	params: Promise<{ workspaceId: string }>;
}) {
	const [{ workspaceId }, ctx, cookieStore] = await Promise.all([
		params,
		getAppRequestContext(),
		cookies(),
	]);
	const queryClient = makeQueryClient();
	const now = new Date();
	const timezone = readDeviceTimezoneCookie(
		cookieStore.get(DEVICE_TIMEZONE_COOKIE_NAME)?.value,
	);
	const localNow = timezone ? localDateAndTime(now, timezone) : null;
	const upcomingRange = localNow ? getHomeUpcomingRange(localNow.date) : null;

	await Promise.all([
		...(localNow && upcomingRange
			? [
					queryClient.prefetchQuery(
						serverUseCaseQueryOptions(
							listTasksQueryOptions(
								workspaceId,
								"open",
								"mine",
								TODAY_TASK_LIMIT,
								{ dueOnOrBefore: localNow.date },
							),
							listTasksUseCase,
							ctx,
							{
								workspaceId,
								filter: "open",
								scope: "mine",
								limit: TODAY_TASK_LIMIT,
								dueOnOrBefore: localNow.date,
							},
						),
					),
					queryClient.prefetchQuery(
						serverUseCaseQueryOptions(
							listTasksQueryOptions(
								workspaceId,
								"open",
								"mine",
								UPCOMING_TASK_SUMMARY_LIMIT,
								{
									dueOnOrAfter: upcomingRange.start,
									dueOnOrBefore: upcomingRange.end,
								},
							),
							listTasksUseCase,
							ctx,
							{
								workspaceId,
								filter: "open",
								scope: "mine",
								limit: UPCOMING_TASK_SUMMARY_LIMIT,
								dueOnOrAfter: upcomingRange.start,
								dueOnOrBefore: upcomingRange.end,
							},
						),
					),
				]
			: []),
		queryClient.prefetchQuery(
			serverUseCaseQueryOptions(
				getPageNavigationQueryOptions(workspaceId),
				getPageNavigationUseCase,
				ctx,
				{ workspaceId },
			),
		),
		queryClient.prefetchQuery(
			serverUseCaseQueryOptions(
				getCanvasNavigationQueryOptions(workspaceId),
				getCanvasNavigationUseCase,
				ctx,
				{ workspaceId },
			),
		),
	]);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<HomeView key={workspaceId} workspaceId={workspaceId} />
		</HydrationBoundary>
	);
}
