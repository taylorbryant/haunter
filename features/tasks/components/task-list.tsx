"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, FileTextIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/client/auth-client";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { DueDatePicker } from "@/components/due-date-picker";
import { Button } from "@/components/ui/button";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { AssigneePicker } from "@/features/members/components/assignee-picker";
import { invalidatePage } from "@/features/pages/client/queries";
import {
	createTaskMutationOptions,
	deleteTaskMutationOptions,
	invalidateTasks,
	listTasksQueryOptions,
	updateTaskMutationOptions,
} from "@/features/tasks/client/queries";
import { TaskComposer } from "@/features/tasks/components/task-composer";
import type {
	TaskFilter,
	TaskScope,
	TaskWithPage,
} from "@/features/tasks/schemas";
import { cn } from "@/lib/utils";

const TASK_PAGE_SIZE = 50;

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

function isOverdue(task: TaskWithPage): boolean {
	return (
		!task.completed &&
		task.dueDate !== null &&
		task.dueDate < new Date().toISOString().slice(0, 10)
	);
}

export function TaskList({ workspaceId }: { workspaceId: string }) {
	const queryClient = useQueryClient();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	// Viewers see the list but get no add/toggle/edit/delete controls.
	const canEdit = useCanEditWorkspace();
	const session = authClient.useSession();
	const filter = readTaskFilter(searchParams.get("filter"));
	const scope = readTaskScope(searchParams.get("scope"));
	const [limit, setLimit] = useState(TASK_PAGE_SIZE);
	const [composing, setComposing] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editTitle, setEditTitle] = useState("");
	const [taskToDelete, setTaskToDelete] = useState<TaskWithPage | null>(null);

	const tasksQuery = useQuery(
		listTasksQueryOptions(workspaceId, filter, scope, limit),
	);
	const createMutation = useMutation(createTaskMutationOptions());
	const updateMutation = useMutation(updateTaskMutationOptions());
	const deleteMutation = useMutation(deleteTaskMutationOptions());

	const tasks = tasksQuery.data?.items ?? [];
	const hasMore = tasksQuery.data?.hasMore ?? false;

	// Opened from the ⌘K "Create task" command: reveal the composer, then strip
	// the query param so a refresh or back-navigation doesn't reopen it.
	useEffect(() => {
		if (searchParams.get("compose") !== "1") return;
		if (canEdit) setComposing(true);
		const params = new URLSearchParams(searchParams);
		params.delete("compose");
		const queryString = params.toString();
		router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, {
			scroll: false,
		});
	}, [searchParams, router, pathname, canEdit]);

	async function refresh(task?: TaskWithPage) {
		await invalidateTasks(queryClient);
		// Keep an open editor for the source page consistent.
		if (task?.pageId) {
			await invalidatePage(queryClient, task.pageId);
		}
	}

	// Standalone tasks are renamed here; page-sourced titles live in the page
	// document and are edited in the editor.
	function commitTitle(task: TaskWithPage) {
		const trimmed = editTitle.trim();
		setEditingId(null);
		if (!trimmed || trimmed === task.title) return;
		updateMutation.mutate(
			{ path: { id: task.id }, body: { title: trimmed } },
			{ onSuccess: () => refresh(task) },
		);
	}

	function createTask(input: {
		title: string;
		dueDate: string | null;
		assigneeId?: string | null;
	}): Promise<boolean> {
		return new Promise((resolve) => {
			createMutation.mutate(
				{
					body: {
						workspaceId,
						title: input.title,
						...(input.dueDate ? { dueDate: input.dueDate } : {}),
						...(input.assigneeId !== undefined
							? { assigneeId: input.assigneeId }
							: {}),
					},
				},
				{
					onSuccess: async () => {
						await refresh();
						resolve(true);
					},
					onError: () => resolve(false),
				},
			);
		});
	}

	function confirmDeleteTask() {
		if (!taskToDelete || deleteMutation.isPending) return;
		deleteMutation.mutate(
			{ path: { id: taskToDelete.id } },
			{
				onSuccess: async () => {
					setTaskToDelete(null);
					await refresh(taskToDelete);
				},
			},
		);
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

	return (
		<div className="flex flex-col gap-4">
			{!canEdit ? null : composing ? (
				<TaskComposer
					currentUserId={session.data?.user.id ?? null}
					onSubmit={createTask}
					onCancel={() => setComposing(false)}
				/>
			) : (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="w-fit text-muted-foreground"
					onClick={() => setComposing(true)}
				>
					<PlusIcon />
					Add task
				</Button>
			)}
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
			{tasksQuery.isPending ? (
				<p className="text-muted-foreground text-sm">Loading…</p>
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
					<ul className="flex flex-col divide-y">
						{tasks.map((task) => (
							<li
								key={task.id}
								className="group flex items-start gap-3 py-2 [contain-intrinsic-size:0_52px] [content-visibility:auto]"
							>
								<input
									type="checkbox"
									checked={task.completed}
									disabled={!canEdit}
									className={cn(
										"mt-0.5 size-4 shrink-0 accent-primary",
										canEdit && "cursor-pointer",
									)}
									aria-label={
										task.completed ? "Mark task open" : "Mark task done"
									}
									onChange={(event) =>
										updateMutation.mutate(
											{
												path: { id: task.id },
												body: { completed: event.target.checked },
											},
											{ onSuccess: () => refresh(task) },
										)
									}
								/>
								{/* Stacks title over the chips on mobile; sm+ lays them out
							    side by side on one line. */}
								<div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
									<div className="min-w-0 flex-1">
										{editingId === task.id ? (
											<input
												// biome-ignore lint/a11y/noAutofocus: opened by an explicit tap on the title
												autoFocus
												value={editTitle}
												aria-label="Task name"
												className="keyboard-focus-ring w-full rounded-sm bg-transparent text-base leading-tight outline-none [--keyboard-focus-ring-size:2px] sm:text-sm"
												onChange={(event) => setEditTitle(event.target.value)}
												onKeyDown={(event) => {
													if (event.key === "Enter") commitTitle(task);
													if (event.key === "Escape") setEditingId(null);
												}}
												onBlur={() => commitTitle(task)}
											/>
										) : task.sourceBlockId === null && canEdit ? (
											<button
												type="button"
												className={cn(
													"block max-w-full cursor-text truncate text-left text-sm",
													task.completed &&
														"text-muted-foreground line-through",
												)}
												onClick={() => {
													setEditTitle(task.title);
													setEditingId(task.id);
												}}
											>
												{task.title || "Untitled task"}
											</button>
										) : (
											<p
												className={cn(
													"truncate text-sm",
													task.completed &&
														"text-muted-foreground line-through",
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
										<AssigneePicker
											value={task.assigneeId}
											disabled={!canEdit}
											onChange={(next) =>
												updateMutation.mutate(
													{
														path: { id: task.id },
														body: { assigneeId: next },
													},
													{ onSuccess: () => refresh(task) },
												)
											}
										/>
										{canEdit ? (
											<DueDatePicker
												value={task.dueDate}
												onChange={(next) =>
													updateMutation.mutate(
														{
															path: { id: task.id },
															body: { dueDate: next },
														},
														{ onSuccess: () => refresh(task) },
													)
												}
												className={cn(
													"flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs",
													task.dueDate === null
														? "text-muted-foreground/70 hover:bg-muted focus-visible:bg-muted aria-expanded:bg-muted"
														: isOverdue(task)
															? "bg-destructive/10 text-destructive"
															: "bg-muted text-muted-foreground",
												)}
											/>
										) : task.dueDate !== null ? (
											// Read-only due chip for viewers.
											<span
												className={cn(
													"flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs",
													isOverdue(task)
														? "bg-destructive/10 text-destructive"
														: "bg-muted text-muted-foreground",
												)}
											>
												<CalendarIcon className="size-3" />
												{task.dueDate}
											</span>
										) : null}
										{task.sourceBlockId === null && canEdit ? (
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="size-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
												aria-label="Delete task"
												disabled={deleteMutation.isPending}
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
					if (!open) setTaskToDelete(null);
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
				onConfirm={confirmDeleteTask}
			/>
		</div>
	);
}
