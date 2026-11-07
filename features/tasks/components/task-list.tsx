"use client";

import { contractErrorMessage } from "@beignet/core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	WorkspaceLink as Link,
	useReplaceWorkspaceSearchParams,
	useWorkspacePathname as usePathname,
	useWorkspaceSearchParams as useSearchParams,
} from "@/client/workspace-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { reportUserError } from "@/client/error-feedback";
import { useDraftSafeRouter as useRouter } from "@/client/use-draft-safe-router";
import { useCurrentUser } from "@/components/app-session-provider";
import { useCreateDialog } from "@/components/create-dialog-provider";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { useDeviceTime } from "@/components/device-time-provider";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/query-error";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import type { TaskCreationInput } from "@/features/tasks/client/mutations";
import {
	invalidateTasksWhenIdle,
	listTasksQueryOptions,
} from "@/features/tasks/client/queries";
import { useTaskMutations } from "@/features/tasks/client/use-task-mutations";
import { useTaskRefetchOptions } from "@/features/tasks/client/use-task-refetch-options";
import { useObservedTaskList } from "@/features/tasks/client/task-view-context";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { TaskIdInputSchema } from "@/features/tasks/schemas";
import {
	TaskComposer,
	type TaskSubmissionResult,
} from "@/features/tasks/components/task-composer";
import {
	formatUpcomingDateHeading,
	groupTasksByDueDate,
	UPCOMING_TASK_SUMMARY_LIMIT,
} from "@/features/tasks/lib/group-tasks-by-due-date";
import {
	TASK_TITLE_MAX_LENGTH,
	TASK_TITLE_TOO_LONG_MESSAGE,
	type TaskFilter,
	type TaskScope,
	type TaskWithPage,
} from "@/features/tasks/schemas";
import { isDueOverdue } from "@/lib/due-date";
import { cn } from "@/lib/utils";
import { TaskListSkeleton } from "./task-list-skeleton";
import { TaskRow, type TaskTitleDraft as TitleDraft } from "./task-row";

const TASK_PAGE_SIZE = 50;
const TODAY_PAGE_SIZE = 200;

const FILTERS: { value: TaskFilter; label: string }[] = [
	{ value: "open", label: "Open" },
	{ value: "completed", label: "Completed" },
	{ value: "all", label: "All" },
];

function readTaskFilter(value: string | null): TaskFilter {
	if (value === "completed" || value === "all") return value;
	return "open";
}

function readTaskScope(value: string | null): TaskScope {
	return value === "mine" ? "mine" : "everyone";
}

function isOverdue(
	task: TaskWithPage,
	today: string,
	currentTime: string,
): boolean {
	return (
		!task.completed &&
		isDueOverdue(task.dueDate, task.dueTime, today, currentTime)
	);
}

export function TaskList({
	workspaceId,
	variant = "default",
	upcomingStartDate,
	upcomingEndDate,
}: {
	workspaceId: string;
	variant?: "default" | "today" | "upcoming";
	upcomingStartDate?: string;
	upcomingEndDate?: string;
}) {
	const queryClient = useQueryClient();
	const refetchOptions = useTaskRefetchOptions();
	const deviceTime = useDeviceTime();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const replaceSearchParams = useReplaceWorkspaceSearchParams();
	const requestsEnabled = useProtectedRequestsEnabled();
	// Viewers see the list but get no add/toggle/edit/delete controls.
	const canEdit = useCanEditWorkspace();
	const currentUser = useCurrentUser();
	const { openCreateTask } = useCreateDialog();
	const isTodayView = variant === "today";
	const isUpcomingView = variant === "upcoming";
	const isHomeView = isTodayView || isUpcomingView;
	const requestedTask = TaskIdInputSchema.safeParse({
		id: searchParams.get("taskId"),
	});
	const focusedTaskId =
		!isHomeView && requestedTask.success ? requestedTask.data.id : undefined;
	const resolvedTodayDate = deviceTime.ready ? deviceTime.today : "1970-01-01";
	const resolvedCurrentTime = deviceTime.ready
		? deviceTime.currentTime
		: "00:00";
	const filter = isHomeView
		? "open"
		: readTaskFilter(searchParams.get("filter"));
	const scope = isHomeView ? "mine" : readTaskScope(searchParams.get("scope"));
	const [limit, setLimit] = useState(
		isTodayView
			? TODAY_PAGE_SIZE
			: isUpcomingView
				? UPCOMING_TASK_SUMMARY_LIMIT
				: TASK_PAGE_SIZE,
	);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [titleDrafts, setTitleDrafts] = useState<Record<string, TitleDraft>>(
		{},
	);
	const editSession = useRef(0);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [taskToDelete, setTaskToDelete] = useState<TaskWithPage | null>(null);
	const deleteSession = useRef(0);
	const mutations = useTaskMutations(workspaceId);
	const { pendingTaskIds, update, isPending } = mutations;

	const tasksQuery = useQuery({
		...listTasksQueryOptions(
			workspaceId,
			filter,
			scope,
			limit,
			isTodayView
				? { dueOnOrBefore: resolvedTodayDate }
				: isUpcomingView
					? {
							dueOnOrAfter: upcomingStartDate,
							dueOnOrBefore: upcomingEndDate,
						}
					: { taskId: focusedTaskId },
		),
		// Refresh stale filters on return, while still deferring during task writes.
		...refetchOptions,
		enabled: deviceTime.ready && requestsEnabled,
	});

	const tasks = tasksQuery.data?.items ?? [];
	const observer = useObservedTaskList(
		{
			view: isTodayView ? "today" : isUpcomingView ? "upcoming" : "tasks",
			filter,
			scope,
			taskId: focusedTaskId,
			...(isTodayView
				? { dueOnOrBefore: resolvedTodayDate }
				: isUpcomingView
					? { dueOnOrAfter: upcomingStartDate, dueOnOrBefore: upcomingEndDate }
					: {}),
			hasMore: tasksQuery.data?.hasMore ?? false,
			status:
				!requestsEnabled || tasksQuery.isError
					? "unavailable"
					: tasksQuery.isPending
						? "loading"
						: "ready",
		},
		tasks,
		pendingTaskIds.size > 0,
		titleDrafts,
	);
	const focusedRow = useRef<HTMLLIElement>(null);
	const focusReady =
		!!focusedTaskId && tasks.some((task) => task.id === focusedTaskId);
	useEffect(() => {
		if (!focusedTaskId || !focusReady) return;
		focusedRow.current?.scrollIntoView({ block: "nearest" });
		focusedRow.current?.focus({ preventScroll: true });
	}, [focusedTaskId, focusReady]);
	const hasMore = tasksQuery.data?.hasMore ?? false;
	const overdueTasks = isTodayView
		? tasks.filter((task) =>
				isOverdue(task, resolvedTodayDate, resolvedCurrentTime),
			)
		: [];
	const todayTasks = isTodayView
		? tasks.filter(
				(task) =>
					task.dueDate === resolvedTodayDate &&
					!isOverdue(task, resolvedTodayDate, resolvedCurrentTime),
			)
		: [];
	const upcomingGroups = isUpcomingView ? groupTasksByDueDate(tasks) : [];

	// Keep old bookmarked task-create URLs working while the command palette
	// and task button now open the workspace dialog directly.
	useEffect(() => {
		if (isHomeView || searchParams.get("compose") !== "1") return;
		if (canEdit) openCreateTask();
		const params = new URLSearchParams(searchParams);
		params.delete("compose");
		const queryString = params.toString();
		router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, {
			scroll: false,
		});
	}, [searchParams, router, pathname, canEdit, isHomeView, openCreateTask]);

	const setTaskCompletion = useCallback(
		async (task: TaskWithPage, completed: boolean) => {
			try {
				await update(task, { completed });
			} catch (error) {
				reportUserError(error, "Task could not be updated. Try again.");
			}
		},
		[update],
	);

	const setTaskSchedule = useCallback(
		async (
			task: TaskWithPage,
			schedule: Pick<
				TaskWithPage,
				"dueDate" | "dueTime" | "reminderOffsetMinutes"
			>,
		) => {
			try {
				await update(task, schedule);
			} catch (error) {
				reportUserError(
					error,
					"Task schedule could not be updated. Try again.",
				);
			}
		},
		[update],
	);

	const setTaskAssignee = useCallback(
		async (
			task: TaskWithPage,
			assigneeId: string | null,
			assigneeName: string | null,
		) => {
			try {
				await update(task, { assigneeId }, assigneeName);
			} catch (error) {
				reportUserError(
					error,
					"Task assignee could not be updated. Try again.",
				);
			}
		},
		[update],
	);

	// Standalone tasks are renamed here; page-sourced titles live in the page
	// document and are edited in the editor.
	const discardTitle = useCallback((taskId: string) => {
		editSession.current++;
		setEditingId((current) => (current === taskId ? null : current));
		setTitleDrafts((current) => {
			const next = { ...current };
			delete next[taskId];
			return next;
		});
	}, []);

	const commitTitle = useCallback(
		async (task: TaskWithPage, draft: TitleDraft | undefined) => {
			if (isPending(workspaceId, task.id)) return;
			if (!draft) return;
			const trimmed = draft.title.trim();
			if (!trimmed || trimmed === task.title) {
				discardTitle(task.id);
				return;
			}
			if (trimmed.length > TASK_TITLE_MAX_LENGTH) {
				setTitleDrafts((current) => ({
					...current,
					[task.id]: { ...draft, error: TASK_TITLE_TOO_LONG_MESSAGE },
				}));
				return;
			}
			const session = editSession.current;
			const submittedDraft: TitleDraft = { title: trimmed };
			setTitleDrafts((current) => ({ ...current, [task.id]: submittedDraft }));
			setEditingId((current) => (current === task.id ? null : current));
			try {
				await update(task, { title: trimmed });
				setTitleDrafts((current) => {
					if (current[task.id] !== submittedDraft) return current;
					const next = { ...current };
					delete next[task.id];
					return next;
				});
			} catch (error) {
				const message = contractErrorMessage(
					error,
					"Task could not be renamed. Try again.",
				);
				setTitleDrafts((current) =>
					current[task.id] === submittedDraft
						? { ...current, [task.id]: { ...submittedDraft, error: message } }
						: current,
				);
				// Reopen a failed submission only if no later editing interaction owns focus.
				if (editSession.current === session) setEditingId(task.id);
			}
		},
		[isPending, workspaceId, discardTitle, update],
	);

	const startTitle = useCallback(
		(task: TaskWithPage) => {
			if (isPending(workspaceId, task.id)) return;
			editSession.current++;
			setTitleDrafts((current) => ({
				...current,
				[task.id]: current[task.id] ?? { title: task.title },
			}));
			setEditingId(task.id);
		},
		[isPending, workspaceId],
	);
	const changeTitle = useCallback((id: string, title: string) => {
		setTitleDrafts((current) => ({ ...current, [id]: { title } }));
	}, []);
	const startDeleteTask = useCallback((task: TaskWithPage) => {
		deleteSession.current++;
		setDeleteError(null);
		setTaskToDelete(task);
	}, []);

	async function createTask(
		input: TaskCreationInput,
	): Promise<TaskSubmissionResult> {
		try {
			await mutations.create(workspaceId, input);
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				error: contractErrorMessage(
					error,
					"Task could not be added. Try again.",
				),
			};
		}
	}

	async function confirmDeleteTask() {
		if (!taskToDelete || mutations.isPending(workspaceId, taskToDelete.id))
			return;
		const target = taskToDelete;
		const session = deleteSession.current;
		setDeleteError(null);
		setTaskToDelete(null);
		try {
			await mutations.remove(target);
		} catch (error) {
			// A later confirmation or dismissal owns the dialog now.
			if (deleteSession.current !== session) {
				reportUserError(
					error,
					`“${target.title || "Untitled task"}” could not be deleted. Try again.`,
				);
				return;
			}
			setTaskToDelete(target);
			setDeleteError(
				contractErrorMessage(error, "Task could not be deleted. Try again."),
			);
		}
	}

	function setTaskListParams(next: { filter?: TaskFilter; scope?: TaskScope }) {
		setLimit(TASK_PAGE_SIZE);
		replaceSearchParams((params) => {
			params.delete("taskId");
			const nextFilter = next.filter ?? readTaskFilter(params.get("filter"));
			const nextScope = next.scope ?? readTaskScope(params.get("scope"));

			if (nextFilter === "open") {
				params.delete("filter");
			} else {
				params.set("filter", nextFilter);
			}

			if (nextScope === "everyone") {
				params.delete("scope");
			} else {
				params.set("scope", nextScope);
			}
		});
	}

	function renderTaskRows(visibleTasks: TaskWithPage[]) {
		return (
			<ul className="flex flex-col divide-y">
				{visibleTasks.map((task) => (
					<TaskRow
						key={task.id}
						task={task}
						workspaceId={workspaceId}
						canEdit={canEdit}
						compact={isHomeView}
						pending={pendingTaskIds.has(task.id)}
						editing={editingId === task.id}
						draft={titleDrafts[task.id]}
						selected={observer?.selectedTaskId === task.id}
						observed={!!observer}
						focused={task.id === focusedTaskId}
						rowRef={task.id === focusedTaskId ? focusedRow : undefined}
						today={resolvedTodayDate}
						overdue={isOverdue(task, resolvedTodayDate, resolvedCurrentTime)}
						onSelect={observer?.select}
						onCompletion={setTaskCompletion}
						onSchedule={setTaskSchedule}
						onAssignee={setTaskAssignee}
						onStartTitle={startTitle}
						onChangeTitle={changeTitle}
						onCommitTitle={commitTitle}
						onDiscardTitle={discardTitle}
						onDelete={startDeleteTask}
					/>
				))}
			</ul>
		);
	}

	if (!deviceTime.ready) {
		return <TaskListSkeleton compact={isHomeView} />;
	}

	return (
		<div className="flex flex-col gap-4">
			{focusedTaskId ? (
				<div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
					<span>Focused task</span>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setTaskListParams({})}
					>
						Show all tasks
					</Button>
				</div>
			) : null}
			{canEdit && isTodayView ? (
				<TaskComposer
					currentUserId={currentUser?.id ?? null}
					defaultDueDate={resolvedTodayDate}
					mode="compact"
					onSubmit={createTask}
				/>
			) : null}
			{isHomeView ? null : (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
					<fieldset
						aria-label="Task status"
						className="flex items-center gap-1"
					>
						{FILTERS.map(({ value, label }) => (
							<Button
								key={value}
								type="button"
								size="sm"
								variant={filter === value ? "secondary" : "ghost"}
								aria-pressed={filter === value}
								onClick={() => setTaskListParams({ filter: value })}
							>
								{label}
							</Button>
						))}
					</fieldset>
					<fieldset
						aria-label="Task assignee"
						className="flex items-center gap-1"
					>
						{(
							[
								{ value: "everyone", label: "Everyone" },
								{ value: "mine", label: "Mine" },
							] as const
						).map(({ value, label }) => (
							<Button
								key={value}
								type="button"
								size="sm"
								variant={scope === value ? "secondary" : "ghost"}
								aria-pressed={scope === value}
								onClick={() => setTaskListParams({ scope: value })}
							>
								{label}
							</Button>
						))}
					</fieldset>
				</div>
			)}
			{tasksQuery.isPending ? (
				<TaskListSkeleton compact={isHomeView} />
			) : tasksQuery.isError && !tasksQuery.data ? (
				<QueryError
					message={
						isTodayView
							? "Today could not be loaded."
							: isUpcomingView
								? "Coming up could not be loaded."
								: "Tasks could not be loaded."
					}
					retrying={tasksQuery.isFetching}
					onRetry={() => void invalidateTasksWhenIdle(queryClient, workspaceId)}
				/>
			) : isTodayView ? (
				<div className="flex flex-col gap-6">
					{overdueTasks.length > 0 ? (
						<section aria-labelledby="overdue-heading">
							<h2
								id="overdue-heading"
								className="mb-1 font-medium text-base sm:text-sm"
							>
								Overdue
							</h2>
							{renderTaskRows(overdueTasks)}
						</section>
					) : null}
					<section aria-labelledby="today-tasks-heading">
						<h2
							id="today-tasks-heading"
							className="mb-1 font-medium text-base sm:text-sm"
						>
							Today
						</h2>
						{todayTasks.length > 0 ? (
							renderTaskRows(todayTasks)
						) : (
							<p className="py-2 text-base text-muted-foreground sm:text-sm">
								Nothing due today.
							</p>
						)}
					</section>
				</div>
			) : isUpcomingView ? (
				<section className="border-t pt-6" aria-labelledby="coming-up-heading">
					<h2
						id="coming-up-heading"
						className="font-medium text-base sm:text-sm"
					>
						Coming up
					</h2>
					{upcomingGroups.length > 0 ? (
						<div className="mt-2 flex flex-col gap-5">
							{upcomingGroups.map((group) => (
								<section
									key={group.date}
									aria-labelledby={`upcoming-${group.date}`}
								>
									<h3
										id={`upcoming-${group.date}`}
										className="font-medium text-muted-foreground text-base sm:text-sm"
									>
										{formatUpcomingDateHeading(group.date, resolvedTodayDate)}
									</h3>
									{renderTaskRows(group.items)}
								</section>
							))}
						</div>
					) : (
						<p className="mt-2 text-pretty text-muted-foreground text-base sm:text-sm">
							Nothing due in the next 7 days.
						</p>
					)}
					{hasMore ? (
						<Link
							href={`/w/${workspaceId}/tasks?scope=mine`}
							className="keyboard-focus-ring mt-3 inline-flex w-fit rounded-sm text-muted-foreground text-base hover:text-foreground sm:text-sm"
						>
							View all tasks
						</Link>
					) : null}
				</section>
			) : tasks.length === 0 ? (
				<p className="text-base text-muted-foreground sm:text-sm">
					{scope === "mine"
						? "Nothing assigned to you."
						: filter === "open"
							? "No open tasks. Nice."
							: "Nothing here yet."}
				</p>
			) : (
				<>
					{renderTaskRows(tasks)}
					{hasMore ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="w-fit text-muted-foreground"
							disabled={tasksQuery.isFetching}
							onClick={() => setLimit((current) => current + TASK_PAGE_SIZE)}
						>
							Load more
						</Button>
					) : null}
				</>
			)}
			<DestructiveConfirmationDialog
				open={taskToDelete !== null}
				onOpenChange={(open) => {
					if (!open) {
						deleteSession.current += 1;
						setTaskToDelete(null);
						setDeleteError(null);
					}
				}}
				title="Delete task?"
				description={
					<span className="break-words">
						This removes {taskToDelete?.title || "Untitled task"} permanently.
						This cannot be undone.
					</span>
				}
				actionLabel="Delete task"
				pendingLabel="Deleting…"
				pending={taskToDelete !== null && pendingTaskIds.has(taskToDelete.id)}
				error={deleteError}
				onConfirm={() => void confirmDeleteTask()}
			/>
		</div>
	);
}
