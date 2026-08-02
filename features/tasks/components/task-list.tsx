"use client";

import { contractErrorMessage } from "@beignet/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BellIcon,
	CalendarIcon,
	FileTextIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { reportUserError } from "@/client/error-feedback";
import { useCurrentUser } from "@/components/app-session-provider";
import { useCreateDialog } from "@/components/create-dialog-provider";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { useDeviceTime } from "@/components/device-time-provider";
import { DueDatePicker } from "@/components/due-date-picker";
import { Button } from "@/components/ui/button";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { AssigneePicker } from "@/features/members/components/assignee-picker";
import { invalidateNotifications } from "@/features/notifications/client/queries";
import { invalidatePage } from "@/features/pages/client/queries";
import { taskWriteLock } from "@/features/tasks/client/completion-lock";
import {
	createOptimisticTaskId,
	createTaskMutationOptions,
	deleteTaskMutationOptions,
	invalidateTasksWhenIdle,
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
	type TaskCacheSnapshot,
	type TaskCompletionCacheSnapshot,
	type TaskCreationCacheSnapshot,
	type TaskScheduleCacheSnapshot,
	updateTaskMutationOptions,
} from "@/features/tasks/client/queries";
import {
	TaskComposer,
	type TaskSubmissionResult,
} from "@/features/tasks/components/task-composer";
import {
	formatUpcomingDateHeading,
	groupTasksByDueDate,
	UPCOMING_TASK_SUMMARY_LIMIT,
} from "@/features/tasks/lib/group-tasks-by-due-date";
import type { TaskReminderOffsetMinutes } from "@/features/tasks/lib/reminder-options";
import {
	TASK_TITLE_MAX_LENGTH,
	TASK_TITLE_TOO_LONG_MESSAGE,
	type TaskFilter,
	type TaskScope,
	type TaskWithPage,
} from "@/features/tasks/schemas";
import {
	formatDueDateTimeLabel,
	isDueOverdue,
	parseIsoDate,
} from "@/lib/due-date";
import { cn } from "@/lib/utils";

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
	const deviceTime = useDeviceTime();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	// Viewers see the list but get no add/toggle/edit/delete controls.
	const canEdit = useCanEditWorkspace();
	const currentUser = useCurrentUser();
	const { openCreateTask } = useCreateDialog();
	const isTodayView = variant === "today";
	const isUpcomingView = variant === "upcoming";
	const isHomeView = isTodayView || isUpcomingView;
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
	const [editTitle, setEditTitle] = useState("");
	const [editError, setEditError] = useState<{
		taskId: string;
		message: string;
	} | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [taskToDelete, setTaskToDelete] = useState<TaskWithPage | null>(null);
	// Every write for one task shares a lock. Separate locks per field allow an
	// older failed mutation to roll back after a newer completion or deletion.
	const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(
		() => new Set(),
	);

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
					: {},
		),
		enabled: deviceTime.ready,
	});
	const createMutation = useMutation({
		...createTaskMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const completionMutation = useMutation({
		...updateTaskMutationOptions(),
		meta: { errorMode: "silent" },
	});
	const scheduleMutation = useMutation({
		...updateTaskMutationOptions(),
		meta: { errorMode: "silent" },
	});
	const assigneeMutation = useMutation({
		...updateTaskMutationOptions(),
		meta: { errorMode: "silent" },
	});
	const renameMutation = useMutation({
		...updateTaskMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const deleteMutation = useMutation({
		...deleteTaskMutationOptions(),
		meta: { errorMode: "inline" },
	});

	const tasks = tasksQuery.data?.items ?? [];
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

	async function refresh(task?: TaskWithPage) {
		await Promise.all([
			invalidateTasksWhenIdle(queryClient),
			invalidateNotifications(queryClient),
		]);
		// Keep an open editor for the source page consistent.
		if (task?.pageId) {
			await invalidatePage(queryClient, task.pageId);
		}
	}

	async function setTaskCompletion(task: TaskWithPage, completed: boolean) {
		await taskWriteLock.run(task.id, async () => {
			setPendingTaskIds((current) => new Set(current).add(task.id));
			let snapshot: TaskCompletionCacheSnapshot | null = null;
			try {
				snapshot = await optimisticallySetTaskCompletion(
					queryClient,
					task.id,
					completed,
				);
				await completionMutation.mutateAsync({
					path: { id: task.id },
					body: { completed },
				});
			} catch (error) {
				if (snapshot) restoreTasksCache(queryClient, snapshot);
				reportUserError(error, "Task could not be updated. Try again.");
			} finally {
				setPendingTaskIds((current) => {
					const next = new Set(current);
					next.delete(task.id);
					return next;
				});
			}
		});
		await Promise.allSettled([
			invalidateTasksWhenIdle(queryClient),
			invalidateNotifications(queryClient),
			task.pageId
				? invalidatePage(queryClient, task.pageId)
				: Promise.resolve(),
		]);
	}

	async function setTaskSchedule(
		task: TaskWithPage,
		schedule: Pick<
			TaskWithPage,
			"dueDate" | "dueTime" | "reminderOffsetMinutes"
		>,
	) {
		await taskWriteLock.run(task.id, async () => {
			setPendingTaskIds((current) => new Set(current).add(task.id));
			let snapshot: TaskScheduleCacheSnapshot | null = null;
			try {
				snapshot = await optimisticallySetTaskSchedule(
					queryClient,
					task.id,
					schedule,
				);
				await scheduleMutation.mutateAsync({
					path: { id: task.id },
					body: schedule,
				});
			} catch (error) {
				if (snapshot) restoreTasksCache(queryClient, snapshot);
				reportUserError(
					error,
					"Task schedule could not be updated. Try again.",
				);
			} finally {
				setPendingTaskIds((current) => {
					const next = new Set(current);
					next.delete(task.id);
					return next;
				});
			}
		});
		await Promise.allSettled([
			invalidateTasksWhenIdle(queryClient),
			invalidateNotifications(queryClient),
			task.pageId
				? invalidatePage(queryClient, task.pageId)
				: Promise.resolve(),
		]);
	}

	async function setTaskAssignee(
		task: TaskWithPage,
		assigneeId: string | null,
		assigneeName: string | null,
	) {
		await taskWriteLock.run(task.id, async () => {
			setPendingTaskIds((current) => new Set(current).add(task.id));
			let snapshot: TaskCacheSnapshot | null = null;
			try {
				snapshot = await optimisticallyPatchTask(
					queryClient,
					task.id,
					{
						assigneeId,
						assigneeName,
					},
					currentUser?.id,
				);
				await assigneeMutation.mutateAsync({
					path: { id: task.id },
					body: { assigneeId },
				});
			} catch (error) {
				if (snapshot) restoreTasksCache(queryClient, snapshot);
				reportUserError(
					error,
					"Task assignee could not be updated. Try again.",
				);
			} finally {
				setPendingTaskIds((current) => {
					const next = new Set(current);
					next.delete(task.id);
					return next;
				});
			}
		});
		await refresh(task);
	}

	// Standalone tasks are renamed here; page-sourced titles live in the page
	// document and are edited in the editor.
	async function commitTitle(task: TaskWithPage) {
		if (renameMutation.isPending || pendingTaskIds.has(task.id)) return;
		const trimmed = editTitle.trim();
		if (!trimmed || trimmed === task.title) {
			setEditingId(null);
			setEditError(null);
			return;
		}
		if (trimmed.length > TASK_TITLE_MAX_LENGTH) {
			setEditError({
				taskId: task.id,
				message: TASK_TITLE_TOO_LONG_MESSAGE,
			});
			return;
		}
		setEditError(null);
		setEditingId((current) => (current === task.id ? null : current));
		await taskWriteLock.run(task.id, async () => {
			setPendingTaskIds((current) => new Set(current).add(task.id));
			let snapshot: TaskCacheSnapshot | null = null;
			try {
				snapshot = await optimisticallyPatchTask(queryClient, task.id, {
					title: trimmed,
				});
				await renameMutation.mutateAsync({
					path: { id: task.id },
					body: { title: trimmed },
				});
			} catch (error) {
				if (snapshot) restoreTasksCache(queryClient, snapshot);
				setEditTitle(trimmed);
				setEditingId(task.id);
				setEditError({
					taskId: task.id,
					message: contractErrorMessage(
						error,
						"Task could not be renamed. Try again.",
					),
				});
			} finally {
				setPendingTaskIds((current) => {
					const next = new Set(current);
					next.delete(task.id);
					return next;
				});
			}
		});
		await refresh(task);
	}

	async function createTask(input: {
		title: string;
		dueDate: string | null;
		dueTime: string | null;
		reminderOffsetMinutes: TaskReminderOffsetMinutes;
		assigneeId?: string | null;
	}): Promise<TaskSubmissionResult> {
		const now = new Date().toISOString();
		const temporaryTask = currentUser
			? ({
					id: createOptimisticTaskId(),
					userId: currentUser.id,
					workspaceId,
					pageId: null,
					sourceBlockId: null,
					title: input.title,
					completed: false,
					dueDate: input.dueDate,
					dueTime: input.dueTime,
					reminderOffsetMinutes: input.reminderOffsetMinutes,
					assigneeId:
						input.assigneeId === undefined ? currentUser.id : input.assigneeId,
					completedAt: null,
					createdAt: now,
					updatedAt: now,
					pageTitle: null,
					assigneeName:
						input.assigneeId === undefined ||
						input.assigneeId === currentUser.id
							? currentUser.name || currentUser.email
							: null,
				} satisfies TaskWithPage)
			: null;
		const writeId = temporaryTask?.id ?? createOptimisticTaskId();
		const result = await taskWriteLock.run(writeId, async () => {
			let cacheSnapshot: TaskCreationCacheSnapshot | null = null;
			try {
				if (temporaryTask && currentUser) {
					cacheSnapshot = await optimisticallyAddTask(
						queryClient,
						temporaryTask,
						currentUser.id,
					);
				}
				const created = await createMutation.mutateAsync({
					body: {
						workspaceId,
						title: input.title,
						...(input.dueDate ? { dueDate: input.dueDate } : {}),
						...(input.dueTime ? { dueTime: input.dueTime } : {}),
						...(input.reminderOffsetMinutes !== null
							? { reminderOffsetMinutes: input.reminderOffsetMinutes }
							: {}),
						...(input.assigneeId !== undefined
							? { assigneeId: input.assigneeId }
							: {}),
					},
				});
				if (temporaryTask) {
					replaceOptimisticTask(queryClient, temporaryTask.id, {
						...created,
						pageTitle: null,
						assigneeName: temporaryTask.assigneeName,
					});
				}
				return { ok: true } satisfies TaskSubmissionResult;
			} catch (error) {
				if (temporaryTask && cacheSnapshot) {
					restoreTaskCreationCache(
						queryClient,
						temporaryTask.id,
						cacheSnapshot,
					);
				}
				return {
					ok: false,
					error: contractErrorMessage(
						error,
						"Task could not be added. Try again.",
					),
				} satisfies TaskSubmissionResult;
			}
		});
		void refresh().catch(() => undefined);
		return result;
	}

	async function confirmDeleteTask() {
		if (!taskToDelete || deleteMutation.isPending) return;
		const target = taskToDelete;
		const deleted = await taskWriteLock.run(target.id, async () => {
			setPendingTaskIds((current) => new Set(current).add(target.id));
			setDeleteError(null);
			setTaskToDelete(null);
			let snapshot: TaskCacheSnapshot | null = null;
			try {
				snapshot = await optimisticallyRemoveTask(queryClient, target.id);
				await deleteMutation.mutateAsync({ path: { id: target.id } });
				return true;
			} catch (error) {
				if (snapshot) restoreTasksCache(queryClient, snapshot);
				setTaskToDelete(target);
				setDeleteError(
					contractErrorMessage(error, "Task could not be deleted. Try again."),
				);
				return false;
			} finally {
				setPendingTaskIds((current) => {
					const next = new Set(current);
					next.delete(target.id);
					return next;
				});
			}
		});
		if (deleted) await refresh(target);
	}

	function setTaskListParams(next: { filter?: TaskFilter; scope?: TaskScope }) {
		setLimit(TASK_PAGE_SIZE);
		const params = new URLSearchParams(searchParams.toString());
		const nextFilter = next.filter ?? filter;
		const nextScope = next.scope ?? scope;

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

		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false,
		});
	}

	function renderTaskRows(visibleTasks: TaskWithPage[]) {
		return (
			<ul className="flex flex-col divide-y">
				{visibleTasks.map((task) => (
					<li
						key={task.id}
						className="group flex items-start gap-3 py-2 [contain-intrinsic-size:0_52px] [content-visibility:auto]"
					>
						<input
							type="checkbox"
							checked={task.completed}
							disabled={
								!canEdit ||
								isOptimisticTaskId(task.id) ||
								pendingTaskIds.has(task.id)
							}
							className={cn(
								"mt-0.5 size-4 shrink-0 accent-primary",
								canEdit &&
									!isOptimisticTaskId(task.id) &&
									!pendingTaskIds.has(task.id) &&
									"cursor-pointer",
							)}
							aria-label={task.completed ? "Mark task open" : "Mark task done"}
							onChange={(event) =>
								void setTaskCompletion(task, event.target.checked)
							}
						/>
						{/* Stacks title over the chips on mobile; sm+ lays them out
					    side by side on one line. */}
						<div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
							<div className="min-w-0 flex-1">
								{editingId === task.id ? (
									<>
										<input
											// biome-ignore lint/a11y/noAutofocus: opened by an explicit tap on the title
											autoFocus
											value={editTitle}
											aria-label="Task name"
											maxLength={TASK_TITLE_MAX_LENGTH}
											className="keyboard-focus-ring w-full rounded-sm bg-transparent text-base leading-tight outline-none [--keyboard-focus-ring-size:2px] sm:text-sm"
											onChange={(event) => {
												setEditTitle(event.target.value);
												setEditError(null);
											}}
											onKeyDown={(event) => {
												if (event.key === "Enter") void commitTitle(task);
												if (event.key === "Escape") {
													setEditingId(null);
													setEditError(null);
												}
											}}
											onBlur={() => void commitTitle(task)}
										/>
										{editError?.taskId === task.id ? (
											<p role="alert" className="mt-1 text-destructive text-xs">
												{editError.message}
											</p>
										) : null}
									</>
								) : task.sourceBlockId === null &&
									canEdit &&
									!isOptimisticTaskId(task.id) ? (
									<button
										type="button"
										className={cn(
											"block max-w-full cursor-text truncate text-left text-sm",
											task.completed && "text-muted-foreground line-through",
										)}
										disabled={
											renameMutation.isPending || pendingTaskIds.has(task.id)
										}
										onClick={() => {
											setEditTitle(task.title);
											setEditError(null);
											setEditingId(task.id);
										}}
									>
										{task.title || "Untitled task"}
									</button>
								) : (
									<p
										className={cn(
											"truncate text-sm",
											task.completed && "text-muted-foreground line-through",
										)}
									>
										{task.title || "Untitled task"}
									</p>
								)}
								{task.pageId ? (
									<Link
										href={`/w/${workspaceId}/p/${task.pageId}`}
										className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
									>
										<FileTextIcon className="size-3" />
										{task.pageTitle || "Untitled"}
									</Link>
								) : null}
							</div>
							<div className="flex items-center gap-1 sm:shrink-0">
								{isHomeView ? null : (
									<AssigneePicker
										value={task.assigneeId}
										label={
											task.assigneeName ?? (task.assigneeId ? "Assigned" : null)
										}
										disabled={
											!canEdit ||
											isOptimisticTaskId(task.id) ||
											pendingTaskIds.has(task.id)
										}
										onChange={(next, label) =>
											void setTaskAssignee(task, next, label ?? null)
										}
									/>
								)}
								{canEdit ? (
									<DueDatePicker
										value={task.dueDate}
										time={task.dueTime}
										reminderOffsetMinutes={task.reminderOffsetMinutes}
										disabled={
											isOptimisticTaskId(task.id) || pendingTaskIds.has(task.id)
										}
										onChange={(next) =>
											void setTaskSchedule(task, {
												dueDate: next.date,
												dueTime: next.time,
												reminderOffsetMinutes: next.reminderOffsetMinutes,
											})
										}
										className={cn(
											"flex shrink-0 cursor-pointer items-center gap-1 rounded-md py-0.5 pr-1.5 pl-1 text-xs",
											task.dueDate === null
												? "text-muted-foreground/70 hover:bg-muted focus-visible:bg-muted aria-expanded:bg-muted"
												: isOverdue(
															task,
															resolvedTodayDate,
															resolvedCurrentTime,
														)
													? "bg-destructive/10 text-destructive"
													: "bg-muted text-muted-foreground",
										)}
									/>
								) : task.dueDate !== null ? (
									<span
										className={cn(
											"flex shrink-0 items-center gap-1 rounded-md py-0.5 pr-1.5 pl-1 text-xs",
											isOverdue(task, resolvedTodayDate, resolvedCurrentTime)
												? "bg-destructive/10 text-destructive"
												: "bg-muted text-muted-foreground",
										)}
									>
										<CalendarIcon className="size-4 shrink-0" />
										{formatDueDateTimeLabel(
											task.dueDate,
											task.dueTime,
											parseIsoDate(resolvedTodayDate),
										)}
										{task.reminderOffsetMinutes !== null ? (
											<BellIcon
												className="size-3 shrink-0"
												aria-hidden="true"
											/>
										) : null}
									</span>
								) : null}
								{task.sourceBlockId === null && canEdit ? (
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="size-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
										aria-label="Delete task"
										disabled={
											deleteMutation.isPending ||
											isOptimisticTaskId(task.id) ||
											pendingTaskIds.has(task.id)
										}
										onClick={() => setTaskToDelete(task)}
									>
										<Trash2Icon className="size-3.5" />
									</Button>
								) : null}
							</div>
						</div>
					</li>
				))}
			</ul>
		);
	}

	if (!deviceTime.ready) {
		return <p className="text-muted-foreground text-sm">Loading…</p>;
	}

	return (
		<div className="flex flex-col gap-4">
			{!canEdit ? null : isTodayView ? (
				<TaskComposer
					currentUserId={currentUser?.id ?? null}
					defaultDueDate={resolvedTodayDate}
					mode="compact"
					onSubmit={createTask}
				/>
			) : isUpcomingView ? null : (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="w-fit text-muted-foreground"
					onClick={openCreateTask}
				>
					<PlusIcon />
					Add task
				</Button>
			)}
			{isHomeView ? null : (
				<div className="flex flex-wrap items-center gap-1">
					{FILTERS.map(({ value, label }) => (
						<Button
							key={value}
							type="button"
							size="sm"
							variant={filter === value ? "secondary" : "ghost"}
							onClick={() => setTaskListParams({ filter: value })}
						>
							{label}
						</Button>
					))}
					<div className="mx-1 h-4 w-px bg-border" />
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
							onClick={() => setTaskListParams({ scope: value })}
						>
							{label}
						</Button>
					))}
				</div>
			)}
			{tasksQuery.isPending ? (
				<p className="text-muted-foreground text-sm">Loading…</p>
			) : tasksQuery.isError && !tasksQuery.data ? (
				<div className="flex items-center gap-2 text-sm">
					<p className="text-muted-foreground">
						{isTodayView
							? "Today could not be loaded."
							: isUpcomingView
								? "Coming up could not be loaded."
								: "Tasks could not be loaded."}
					</p>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => tasksQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			) : isTodayView ? (
				<div className="flex flex-col gap-6">
					{overdueTasks.length > 0 ? (
						<section aria-labelledby="overdue-heading">
							<h2
								id="overdue-heading"
								className="mb-1 font-medium text-muted-foreground text-sm"
							>
								Overdue
							</h2>
							{renderTaskRows(overdueTasks)}
						</section>
					) : null}
					<section aria-labelledby="today-tasks-heading">
						<h2
							id="today-tasks-heading"
							className="mb-1 font-medium text-muted-foreground text-sm"
						>
							Today
						</h2>
						{todayTasks.length > 0 ? (
							renderTaskRows(todayTasks)
						) : (
							<p className="py-2 text-muted-foreground text-sm">
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
							className="mt-3 inline-flex w-fit text-muted-foreground text-base hover:text-foreground sm:text-sm"
						>
							View all tasks
						</Link>
					) : null}
				</section>
			) : tasks.length === 0 ? (
				<p className="text-muted-foreground text-sm">
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
				pending={deleteMutation.isPending}
				error={deleteError}
				onConfirm={() => void confirmDeleteTask()}
			/>
		</div>
	);
}
