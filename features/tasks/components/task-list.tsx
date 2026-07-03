"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileTextIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DueDatePicker } from "@/components/due-date-picker";
import { Button } from "@/components/ui/button";
import { invalidatePage } from "@/features/pages/client/queries";
import { TaskComposer } from "@/features/tasks/components/task-composer";
import {
	createTaskMutationOptions,
	deleteTaskMutationOptions,
	invalidateTasks,
	listTasksQueryOptions,
	updateTaskMutationOptions,
} from "@/features/tasks/client/queries";
import type { TaskFilter, TaskWithPage } from "@/features/tasks/schemas";
import { cn } from "@/lib/utils";

const FILTERS: { value: TaskFilter; label: string }[] = [
	{ value: "open", label: "Open" },
	{ value: "completed", label: "Completed" },
	{ value: "all", label: "All" },
];

function isOverdue(task: TaskWithPage): boolean {
	return (
		!task.completed &&
		task.dueDate !== null &&
		task.dueDate < new Date().toISOString().slice(0, 10)
	);
}

export function TaskList({ workspaceId }: { workspaceId: string }) {
	const queryClient = useQueryClient();
	const [filter, setFilter] = useState<TaskFilter>("open");
	const [composing, setComposing] = useState(false);

	const tasksQuery = useQuery(listTasksQueryOptions(workspaceId, filter));
	const createMutation = useMutation(createTaskMutationOptions());
	const updateMutation = useMutation(updateTaskMutationOptions());
	const deleteMutation = useMutation(deleteTaskMutationOptions());

	const tasks = tasksQuery.data?.items ?? [];

	async function refresh(task?: TaskWithPage) {
		await invalidateTasks(queryClient);
		// Keep an open editor for the source page consistent.
		if (task?.pageId) {
			await invalidatePage(queryClient, task.pageId);
		}
	}

	function createTask(input: {
		title: string;
		dueDate: string | null;
	}): Promise<boolean> {
		return new Promise((resolve) => {
			createMutation.mutate(
				{
					body: {
						workspaceId,
						title: input.title,
						...(input.dueDate ? { dueDate: input.dueDate } : {}),
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

	return (
		<div className="flex flex-col gap-4">
			{composing ? (
				<TaskComposer
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
			<div className="flex gap-1">
				{FILTERS.map(({ value, label }) => (
					<Button
						key={value}
						type="button"
						size="sm"
						variant={filter === value ? "secondary" : "ghost"}
						onClick={() => setFilter(value)}
					>
						{label}
					</Button>
				))}
			</div>
			{tasksQuery.isPending ? (
				<p className="text-muted-foreground text-sm">Loading…</p>
			) : tasks.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{filter === "open" ? "No open tasks. Nice." : "Nothing here yet."}
				</p>
			) : (
				<ul className="flex flex-col divide-y">
					{tasks.map((task) => (
						<li key={task.id} className="group flex items-center gap-3 py-2">
							<input
								type="checkbox"
								checked={task.completed}
								className="size-4 shrink-0 cursor-pointer accent-primary"
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
							<div className="min-w-0 flex-1">
								<p
									className={cn(
										"truncate text-sm",
										task.completed && "text-muted-foreground line-through",
									)}
								>
									{task.title || "Untitled task"}
								</p>
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
										? "text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
										: isOverdue(task)
											? "bg-destructive/10 text-destructive"
											: "bg-muted text-muted-foreground",
								)}
							/>
							{task.sourceBlockId === null ? (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-7 opacity-0 transition-opacity group-hover:opacity-100"
									aria-label="Delete task"
									onClick={() =>
										deleteMutation.mutate(
											{ path: { id: task.id } },
											{ onSuccess: () => refresh() },
										)
									}
								>
									<Trash2Icon className="size-3.5" />
								</Button>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
