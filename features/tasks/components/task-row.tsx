"use client";

import { memo, type Ref } from "react";
import { BellIcon, CalendarIcon, FileTextIcon, Trash2Icon } from "lucide-react";
import { WorkspaceLink as Link } from "@/client/workspace-navigation";
import { DueDatePicker } from "@/components/due-date-picker";
import { Button } from "@/components/ui/button";
import { AssigneePicker } from "@/features/members/components/assignee-picker";
import { isOptimisticTaskId } from "../client/queries";
import { TASK_TITLE_MAX_LENGTH, type TaskWithPage } from "../schemas";
import { formatDueDateTimeLabel, parseIsoDate } from "@/lib/due-date";
import { useInlineEditFocus } from "@/hooks/use-inline-edit-focus";
import { cn } from "@/lib/utils";

export type TaskTitleDraft = { title: string; error?: string };
type TaskRowProps = {
	task: TaskWithPage;
	workspaceId: string;
	canEdit: boolean;
	compact: boolean;
	pending: boolean;
	editing: boolean;
	draft: TaskTitleDraft | undefined;
	selected: boolean;
	observed: boolean;
	focused: boolean;
	rowRef: Ref<HTMLLIElement> | undefined;
	today: string;
	overdue: boolean;
	onSelect: ((id: string) => void) | undefined;
	onCompletion(task: TaskWithPage, completed: boolean): Promise<void>;
	onSchedule(
		task: TaskWithPage,
		schedule: Pick<
			TaskWithPage,
			"dueDate" | "dueTime" | "reminderOffsetMinutes"
		>,
	): Promise<void>;
	onAssignee(
		task: TaskWithPage,
		id: string | null,
		name: string | null,
	): Promise<void>;
	onStartTitle(task: TaskWithPage): void;
	onChangeTitle(id: string, title: string): void;
	onCommitTitle(
		task: TaskWithPage,
		draft: TaskTitleDraft | undefined,
	): Promise<void>;
	onDiscardTitle(id: string): void;
	onDelete(task: TaskWithPage): void;
};

// Stable row props keep editing one title from rebuilding every date/assignee picker.
export const TaskRow = memo(function TaskRow({
	task,
	workspaceId,
	canEdit,
	compact,
	pending,
	editing,
	draft,
	selected,
	observed,
	focused,
	rowRef,
	today,
	overdue,
	onSelect,
	onCompletion,
	onSchedule,
	onAssignee,
	onStartTitle,
	onChangeTitle,
	onCommitTitle,
	onDiscardTitle,
	onDelete,
}: TaskRowProps) {
	const renameFocus = useInlineEditFocus();
	return (
		<li
			ref={rowRef}
			data-task-id={task.id}
			aria-current={selected ? true : undefined}
			tabIndex={observed || focused ? 0 : undefined}
			onFocusCapture={() => onSelect?.(task.id)}
			onPointerDown={() => onSelect?.(task.id)}
			className={cn(
				"group flex items-start gap-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring [contain-intrinsic-size:0_52px] [content-visibility:auto]",
				selected && "rounded-md bg-accent/40",
			)}
		>
			<input
				type="checkbox"
				checked={task.completed}
				disabled={!canEdit || isOptimisticTaskId(task.id) || pending}
				className={cn(
					"mt-0.5 size-4 shrink-0 accent-primary",
					canEdit &&
						!isOptimisticTaskId(task.id) &&
						!pending &&
						"cursor-pointer",
				)}
				aria-label={task.completed ? "Mark task open" : "Mark task done"}
				onChange={(event) => void onCompletion(task, event.target.checked)}
			/>
			{/* Stacks title over the chips on mobile; sm+ lays them out
			    side by side on one line. */}
			<div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
				<div className="min-w-0 flex-1">
					{editing ? (
						<input
							// biome-ignore lint/a11y/noAutofocus: opened by an explicit tap on the title
							autoFocus
							value={draft?.title ?? task.title}
							aria-label="Task name"
							maxLength={TASK_TITLE_MAX_LENGTH}
							className="keyboard-focus-ring w-full rounded-sm bg-transparent text-base leading-tight outline-none [--keyboard-focus-ring-size:2px] sm:text-sm"
							onChange={(event) => onChangeTitle(task.id, event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === "Escape") {
									event.preventDefault();
									renameFocus.requestReturn(event.currentTarget);
								}
								if (event.key === "Enter") void onCommitTitle(task, draft);
								if (event.key === "Escape") {
									onDiscardTitle(task.id);
								}
							}}
							onBlur={() => void onCommitTitle(task, draft)}
						/>
					) : task.sourceBlockId === null &&
						canEdit &&
						!isOptimisticTaskId(task.id) ? (
						<button
							type="button"
							className={cn(
								"keyboard-focus-ring block max-w-full cursor-text rounded-sm text-left text-base leading-6 [overflow-wrap:anywhere] [--keyboard-focus-ring-size:2px] sm:text-sm",
								task.completed && "text-muted-foreground line-through",
							)}
							ref={renameFocus.returnTargetRef}
							aria-disabled={pending}
							onClick={() => {
								if (!pending) onStartTitle(task);
							}}
						>
							{task.title || "Untitled task"}
						</button>
					) : (
						<p
							className={cn(
								"text-base leading-6 [overflow-wrap:anywhere] sm:text-sm",
								task.completed && "text-muted-foreground line-through",
							)}
						>
							{task.title || "Untitled task"}
						</p>
					)}
					{draft?.error ? (
						<p role="alert" className="mt-1 text-destructive text-xs">
							{draft.error}
						</p>
					) : null}
					{task.pageId ? (
						<Link
							href={`/w/${workspaceId}/p/${task.pageId}`}
							className="keyboard-focus-ring flex w-fit items-center gap-1 rounded-sm text-muted-foreground text-xs hover:text-foreground [--keyboard-focus-ring-size:2px]"
						>
							<FileTextIcon className="size-3" />
							{task.pageTitle || "Untitled"}
						</Link>
					) : null}
				</div>
				<div className="flex items-center gap-1 sm:shrink-0">
					{compact ? null : (
						<AssigneePicker
							value={task.assigneeId}
							label={task.assigneeName ?? (task.assigneeId ? "Assigned" : null)}
							disabled={!canEdit || isOptimisticTaskId(task.id) || pending}
							onChange={(next, label) =>
								void onAssignee(task, next, label ?? null)
							}
						/>
					)}
					{canEdit ? (
						<DueDatePicker
							value={task.dueDate}
							time={task.dueTime}
							reminderOffsetMinutes={task.reminderOffsetMinutes}
							disabled={isOptimisticTaskId(task.id) || pending}
							onChange={(next) =>
								void onSchedule(task, {
									dueDate: next.date,
									dueTime: next.time,
									reminderOffsetMinutes: next.reminderOffsetMinutes,
								})
							}
							className={cn(
								"flex shrink-0 cursor-pointer items-center gap-1 rounded-md py-0.5 pr-1.5 pl-1 text-xs",
								task.dueDate === null
									? "text-muted-foreground/70 hover:bg-muted focus-visible:bg-muted aria-expanded:bg-muted"
									: overdue
										? "bg-destructive/10 text-destructive"
										: "bg-muted text-muted-foreground",
							)}
						/>
					) : task.dueDate !== null ? (
						<span
							className={cn(
								"flex shrink-0 items-center gap-1 rounded-md py-0.5 pr-1.5 pl-1 text-xs",
								overdue
									? "bg-destructive/10 text-destructive"
									: "bg-muted text-muted-foreground",
							)}
						>
							<CalendarIcon className="size-4 shrink-0" />
							{formatDueDateTimeLabel(
								task.dueDate,
								task.dueTime,
								parseIsoDate(today),
							)}
							{task.reminderOffsetMinutes !== null ? (
								<BellIcon className="size-3 shrink-0" aria-hidden="true" />
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
							disabled={isOptimisticTaskId(task.id) || pending}
							onClick={() => onDelete(task)}
						>
							<Trash2Icon className="size-3.5" />
						</Button>
					) : null}
				</div>
			</div>
		</li>
	);
});
