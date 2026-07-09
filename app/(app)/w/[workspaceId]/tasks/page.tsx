import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { makeQueryClient } from "@/client";
import { listTasksQueryOptions } from "@/features/tasks/client/queries";
import { TaskList } from "@/features/tasks/components/task-list";
import type { TaskFilter, TaskScope } from "@/features/tasks/schemas";
import { listTasksUseCase } from "@/features/tasks/use-cases";
import {
	getAppRequestContext,
	serverUseCaseQueryOptions,
} from "@/lib/server-react-query";

const TASK_PAGE_SIZE = 50;

function readSingle(value: string | string[] | undefined): string | null {
	if (Array.isArray(value)) return value[0] ?? null;
	return value ?? null;
}

function readTaskFilter(value: string | null): TaskFilter {
	if (value === "completed" || value === "all") return value;
	return "open";
}

function readTaskScope(value: string | null): TaskScope {
	return value === "mine" ? "mine" : "everyone";
}

export default async function TasksPage({
	params,
	searchParams,
}: {
	params: Promise<{ workspaceId: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const [{ workspaceId }, query, ctx] = await Promise.all([
		params,
		searchParams,
		getAppRequestContext(),
	]);
	const filter = readTaskFilter(readSingle(query.filter));
	const scope = readTaskScope(readSingle(query.scope));
	const queryClient = makeQueryClient();

	await queryClient.prefetchQuery(
		serverUseCaseQueryOptions(
			listTasksQueryOptions(workspaceId, filter, scope, TASK_PAGE_SIZE),
			listTasksUseCase,
			ctx,
			{ workspaceId, filter, scope, limit: TASK_PAGE_SIZE },
		),
	);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
				<h1 className="font-heading font-semibold text-xl">Tasks</h1>
				<TaskList workspaceId={workspaceId} />
			</div>
		</HydrationBoundary>
	);
}
