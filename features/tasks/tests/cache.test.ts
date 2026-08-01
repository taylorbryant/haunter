import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	listTasksQueryOptions,
	optimisticallySetTaskCompletion,
	restoreTasksCache,
} from "@/features/tasks/client/queries";
import type { ListTasksOutput, TaskWithPage } from "@/features/tasks/schemas";

const task: TaskWithPage = {
	id: "31cc7263-1358-47f0-88cc-a4595ff26b0e",
	userId: "user_1",
	workspaceId: "workspace_1",
	pageId: null,
	sourceBlockId: null,
	title: "Review the launch plan",
	completed: false,
	dueDate: "2026-07-31",
	dueTime: null,
	reminderOffsetMinutes: null,
	assigneeId: "user_1",
	completedAt: null,
	createdAt: "2026-07-30T14:00:00.000Z",
	updatedAt: "2026-07-30T14:00:00.000Z",
	pageTitle: null,
	assigneeName: "Taylor",
};

const otherTask: TaskWithPage = {
	...task,
	id: "1a6aa7dd-878c-4589-af87-f5d1eec88a3d",
	title: "Publish the launch notes",
};

function output(completed: boolean): ListTasksOutput {
	return {
		items: [
			{
				...task,
				completed,
				completedAt: completed ? "2026-07-31T14:00:00.000Z" : null,
			},
		],
		hasMore: true,
	};
}

test("task completion updates every cached task view and can roll back", async () => {
	const queryClient = new QueryClient();
	const openKey = listTasksQueryOptions("workspace_1", "open", "mine").queryKey;
	const allKey = listTasksQueryOptions(
		"workspace_1",
		"all",
		"everyone",
	).queryKey;
	const previousOpen = output(false);
	const previousAll = output(false);
	queryClient.setQueryData(openKey, previousOpen);
	queryClient.setQueryData(allKey, previousAll);

	const snapshot = await optimisticallySetTaskCompletion(
		queryClient,
		task.id,
		true,
	);

	expect(queryClient.getQueryData<ListTasksOutput>(openKey)).toEqual({
		...previousOpen,
		items: [],
	});
	const optimisticAll = queryClient.getQueryData<ListTasksOutput>(allKey);
	expect(optimisticAll?.items[0]?.completed).toBe(true);
	expect(optimisticAll?.items[0]?.completedAt).not.toBeNull();

	restoreTasksCache(queryClient, snapshot);
	expect(queryClient.getQueryData<ListTasksOutput>(openKey)).toEqual(
		previousOpen,
	);
	expect(queryClient.getQueryData<ListTasksOutput>(allKey)).toEqual(
		previousAll,
	);
});

test("reopening a task immediately removes it from completed views", async () => {
	const queryClient = new QueryClient();
	const completedKey = listTasksQueryOptions(
		"workspace_1",
		"completed",
		"mine",
	).queryKey;
	const allKey = listTasksQueryOptions("workspace_1", "all", "mine").queryKey;
	queryClient.setQueryData(completedKey, output(true));
	queryClient.setQueryData(allKey, output(true));

	await optimisticallySetTaskCompletion(queryClient, task.id, false);

	expect(
		queryClient.getQueryData<ListTasksOutput>(completedKey)?.items,
	).toEqual([]);
	expect(
		queryClient.getQueryData<ListTasksOutput>(allKey)?.items[0],
	).toMatchObject({ completed: false, completedAt: null });
});

test("rolling back one task preserves another optimistic completion", async () => {
	const queryClient = new QueryClient();
	const openKey = listTasksQueryOptions("workspace_1", "open", "mine").queryKey;
	queryClient.setQueryData<ListTasksOutput>(openKey, {
		items: [task, otherTask],
		hasMore: false,
	});

	const firstSnapshot = await optimisticallySetTaskCompletion(
		queryClient,
		task.id,
		true,
	);
	await optimisticallySetTaskCompletion(queryClient, otherTask.id, true);
	restoreTasksCache(queryClient, firstSnapshot);

	expect(queryClient.getQueryData<ListTasksOutput>(openKey)?.items).toEqual([
		task,
	]);
});
