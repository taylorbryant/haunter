import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	createOptimisticTaskId,
	isOptimisticTaskId,
	listTasksQueryOptions,
	optimisticallyAddTask,
	optimisticallyPatchTask,
	optimisticallyRemoveTask,
	optimisticallySetTaskCompletion,
	optimisticallySetTaskSchedule,
	replaceOptimisticTask,
	restoreTaskCreationCache,
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

test("does not remount-refetch hydrated task lists", () => {
	const options = listTasksQueryOptions("workspace_1", "open", "mine");

	expect(options.refetchOnMount).toBe(false);
});

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

test("task schedule updates cached dates immediately and can roll back", async () => {
	const queryClient = new QueryClient();
	const todayKey = listTasksQueryOptions("workspace_1", "open", "mine", 200, {
		dueOnOrBefore: "2026-07-31",
	}).queryKey;
	const allKey = listTasksQueryOptions("workspace_1", "all", "mine").queryKey;
	const laterTask = {
		...otherTask,
		dueDate: "2026-08-02",
		createdAt: "2026-07-30T15:00:00.000Z",
	};
	const previousToday: ListTasksOutput = {
		items: [task],
		hasMore: false,
	};
	const previousAll: ListTasksOutput = {
		items: [task, laterTask],
		hasMore: false,
	};
	queryClient.setQueryData(todayKey, previousToday);
	queryClient.setQueryData(allKey, previousAll);

	const snapshot = await optimisticallySetTaskSchedule(queryClient, task.id, {
		dueDate: "2026-08-03",
		dueTime: "09:00",
		reminderOffsetMinutes: 15,
	});

	expect(queryClient.getQueryData<ListTasksOutput>(todayKey)?.items).toEqual(
		[],
	);
	expect(queryClient.getQueryData<ListTasksOutput>(allKey)?.items).toEqual([
		laterTask,
		{
			...task,
			dueDate: "2026-08-03",
			dueTime: "09:00",
			reminderOffsetMinutes: 15,
		},
	]);

	restoreTasksCache(queryClient, snapshot);
	expect(queryClient.getQueryData<ListTasksOutput>(todayKey)).toEqual(
		previousToday,
	);
	expect(queryClient.getQueryData<ListTasksOutput>(allKey)).toEqual(
		previousAll,
	);
});

test("task metadata updates immediately and removes reassigned tasks from Mine", async () => {
	const queryClient = new QueryClient();
	const mineKey = listTasksQueryOptions("workspace_1", "open", "mine").queryKey;
	const everyoneKey = listTasksQueryOptions(
		"workspace_1",
		"open",
		"everyone",
	).queryKey;
	const previous: ListTasksOutput = { items: [task], hasMore: false };
	queryClient.setQueryData(mineKey, previous);
	queryClient.setQueryData(everyoneKey, previous);

	const snapshot = await optimisticallyPatchTask(
		queryClient,
		task.id,
		{ assigneeId: "user_2", assigneeName: "Morgan" },
		"user_1",
	);

	expect(queryClient.getQueryData<ListTasksOutput>(mineKey)?.items).toEqual([]);
	expect(
		queryClient.getQueryData<ListTasksOutput>(everyoneKey)?.items[0],
	).toMatchObject({ assigneeId: "user_2", assigneeName: "Morgan" });

	restoreTasksCache(queryClient, snapshot);
	expect(queryClient.getQueryData<ListTasksOutput>(mineKey)).toEqual(previous);
	expect(queryClient.getQueryData<ListTasksOutput>(everyoneKey)).toEqual(
		previous,
	);
});

test("rolling back one field preserves a concurrent optimistic task field", async () => {
	const queryClient = new QueryClient();
	const allKey = listTasksQueryOptions(
		"workspace_1",
		"all",
		"everyone",
	).queryKey;
	queryClient.setQueryData<ListTasksOutput>(allKey, {
		items: [task],
		hasMore: false,
	});

	const scheduleSnapshot = await optimisticallySetTaskSchedule(
		queryClient,
		task.id,
		{
			dueDate: "2026-08-03",
			dueTime: "09:00",
			reminderOffsetMinutes: 15,
		},
	);
	await optimisticallyPatchTask(queryClient, task.id, { title: "New title" });
	restoreTasksCache(queryClient, scheduleSnapshot);

	expect(queryClient.getQueryData<ListTasksOutput>(allKey)?.items[0]).toEqual({
		...task,
		title: "New title",
	});
});

test("a failed metadata write does not resurrect a task removed afterward", async () => {
	const queryClient = new QueryClient();
	const allKey = listTasksQueryOptions(
		"workspace_1",
		"all",
		"everyone",
	).queryKey;
	queryClient.setQueryData<ListTasksOutput>(allKey, {
		items: [task],
		hasMore: false,
	});

	const scheduleSnapshot = await optimisticallySetTaskSchedule(
		queryClient,
		task.id,
		{
			dueDate: "2026-08-03",
			dueTime: "09:00",
			reminderOffsetMinutes: 15,
		},
	);
	await optimisticallyRemoveTask(queryClient, task.id);
	restoreTasksCache(queryClient, scheduleSnapshot);

	expect(queryClient.getQueryData<ListTasksOutput>(allKey)?.items).toEqual([]);
});

test("task deletion removes rows immediately and scoped rollback preserves other changes", async () => {
	const queryClient = new QueryClient();
	const allKey = listTasksQueryOptions(
		"workspace_1",
		"all",
		"everyone",
	).queryKey;
	queryClient.setQueryData<ListTasksOutput>(allKey, {
		items: [task, otherTask],
		hasMore: false,
	});

	const snapshot = await optimisticallyRemoveTask(queryClient, task.id);
	await optimisticallyPatchTask(queryClient, otherTask.id, {
		title: "Updated other task",
	});
	expect(
		queryClient
			.getQueryData<ListTasksOutput>(allKey)
			?.items.map((item) => item.id),
	).toEqual([otherTask.id]);

	restoreTasksCache(queryClient, snapshot);
	expect(queryClient.getQueryData<ListTasksOutput>(allKey)?.items).toEqual([
		task,
		{ ...otherTask, title: "Updated other task" },
	]);
});

test("optimistic task creation targets matching lists and reconciles the id", async () => {
	const queryClient = new QueryClient();
	const todayKey = listTasksQueryOptions("workspace_1", "open", "mine", 200, {
		dueOnOrBefore: "2026-07-31",
	}).queryKey;
	const upcomingKey = listTasksQueryOptions(
		"workspace_1",
		"open",
		"mine",
		200,
		{ dueOnOrAfter: "2026-08-01" },
	).queryKey;
	const completedKey = listTasksQueryOptions(
		"workspace_1",
		"completed",
		"mine",
	).queryKey;
	const empty: ListTasksOutput = { items: [], hasMore: false };
	queryClient.setQueryData(todayKey, empty);
	queryClient.setQueryData(upcomingKey, empty);
	queryClient.setQueryData(completedKey, empty);
	const temporaryTask = {
		...task,
		id: createOptimisticTaskId(),
	};

	await optimisticallyAddTask(queryClient, temporaryTask, "user_1");

	expect(isOptimisticTaskId(temporaryTask.id)).toBe(true);
	expect(queryClient.getQueryData<ListTasksOutput>(todayKey)?.items).toEqual([
		temporaryTask,
	]);
	expect(queryClient.getQueryData<ListTasksOutput>(upcomingKey)?.items).toEqual(
		[],
	);
	expect(
		queryClient.getQueryData<ListTasksOutput>(completedKey)?.items,
	).toEqual([]);

	const createdTask = {
		...temporaryTask,
		id: "bd14f9a5-bc0a-4bef-8d43-864cd4456670",
	};
	replaceOptimisticTask(queryClient, temporaryTask.id, createdTask);
	expect(queryClient.getQueryData<ListTasksOutput>(todayKey)?.items).toEqual([
		createdTask,
	]);
});

test("failed task creation restores a row displaced by pagination", async () => {
	const queryClient = new QueryClient();
	const openKey = listTasksQueryOptions(
		"workspace_1",
		"open",
		"mine",
		1,
	).queryKey;
	const displacedTask = { ...task, dueDate: "2026-08-01" };
	queryClient.setQueryData<ListTasksOutput>(openKey, {
		items: [displacedTask],
		hasMore: false,
	});
	const temporaryTask = {
		...task,
		id: createOptimisticTaskId(),
		dueDate: "2026-07-31",
	};

	const snapshot = await optimisticallyAddTask(
		queryClient,
		temporaryTask,
		"user_1",
	);
	expect(queryClient.getQueryData<ListTasksOutput>(openKey)).toEqual({
		items: [temporaryTask],
		hasMore: true,
	});

	restoreTaskCreationCache(queryClient, temporaryTask.id, snapshot);
	expect(queryClient.getQueryData<ListTasksOutput>(openKey)).toEqual({
		items: [displacedTask],
		hasMore: false,
	});
});

test("rolling back one creation preserves another optimistic task", async () => {
	const queryClient = new QueryClient();
	const openKey = listTasksQueryOptions(
		"workspace_1",
		"open",
		"mine",
		1,
	).queryKey;
	const originalTask = { ...task, dueDate: "2026-08-02" };
	queryClient.setQueryData<ListTasksOutput>(openKey, {
		items: [originalTask],
		hasMore: false,
	});
	const firstTask = {
		...task,
		id: createOptimisticTaskId(),
		dueDate: "2026-08-01",
	};
	const secondTask = {
		...task,
		id: createOptimisticTaskId(),
		dueDate: "2026-07-31",
	};

	const firstSnapshot = await optimisticallyAddTask(
		queryClient,
		firstTask,
		"user_1",
	);
	await optimisticallyAddTask(queryClient, secondTask, "user_1");
	// The first request fails while the second request is still pending.
	restoreTaskCreationCache(queryClient, firstTask.id, firstSnapshot);

	expect(queryClient.getQueryData<ListTasksOutput>(openKey)).toEqual({
		items: [secondTask],
		hasMore: true,
	});
});

test("compact task composer clears before submission and restores failures", async () => {
	const source = await Bun.file(
		new URL("../components/task-composer.tsx", import.meta.url),
	).text();
	const optimisticClear = source.indexOf(
		'const clearsOptimistically = mode === "compact";',
	);
	const submission = source.indexOf("result = await onSubmit({");

	expect(optimisticClear).toBeGreaterThan(-1);
	expect(optimisticClear).toBeLessThan(submission);
	expect(source).toContain("setText(submittedDraft.text)");
	expect(source).toContain("setManualDue(submittedDraft.manualDue)");
});
