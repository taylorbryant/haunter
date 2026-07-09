import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { makeQueryClient } from "@/client";
import { notificationSettingsQueryOptions } from "@/features/notifications/client/queries";
import { getNotificationSettingsUseCase } from "@/features/notifications/use-cases";
import { listPagesQueryOptions } from "@/features/pages/client/queries";
import { listPagesUseCase } from "@/features/pages/use-cases";
import { listTasksQueryOptions } from "@/features/tasks/client/queries";
import { listTasksUseCase } from "@/features/tasks/use-cases";
import { TodayView } from "@/features/today/components/today-view";
import {
	getAppRequestContext,
	serverUseCaseQueryOptions,
} from "@/lib/server-react-query";
import { localDateAndHour } from "@/lib/timezone";

const TODAY_TASK_LIMIT = 200;

export default async function TodayPage({
	params,
}: {
	params: Promise<{ workspaceId: string }>;
}) {
	const [{ workspaceId }, ctx] = await Promise.all([
		params,
		getAppRequestContext(),
	]);
	const queryClient = makeQueryClient();
	const now = new Date();
	const settings = await queryClient.fetchQuery(
		serverUseCaseQueryOptions(
			notificationSettingsQueryOptions(),
			getNotificationSettingsUseCase,
			ctx,
			{},
		),
	);
	const todayDate = localDateAndHour(now, settings.timezone).date;

	await Promise.all([
		queryClient.prefetchQuery(
			serverUseCaseQueryOptions(
				listTasksQueryOptions(workspaceId, "open", "mine", TODAY_TASK_LIMIT, {
					dueOnOrBefore: todayDate,
				}),
				listTasksUseCase,
				ctx,
				{
					workspaceId,
					filter: "open",
					scope: "mine",
					limit: TODAY_TASK_LIMIT,
					dueOnOrBefore: todayDate,
				},
			),
		),
		queryClient.prefetchQuery(
			serverUseCaseQueryOptions(
				listPagesQueryOptions(workspaceId),
				listPagesUseCase,
				ctx,
				{ workspaceId },
			),
		),
	]);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<TodayView
				workspaceId={workspaceId}
				initialNow={now.getTime()}
				initialTimezone={settings.timezone}
			/>
		</HydrationBoundary>
	);
}
