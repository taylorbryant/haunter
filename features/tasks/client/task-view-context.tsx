"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import type { SelectedTask, TaskListView, TaskView } from "../current-view";
import { TASK_TITLE_MAX_LENGTH, type TaskWithPage } from "../schemas";
import { isOptimisticTaskId } from "./queries";

type ListReport = {
	list: TaskListView;
	selectedTask?: SelectedTask;
	saveStatus: TaskView["saveStatus"];
};
const TaskViewContext = createContext<{
	selectedTaskId?: string;
	select(id: string): void;
	report(key: string, value: ListReport | undefined): void;
} | null>(null);
export const useTaskViewContext = () => useContext(TaskViewContext);

export function useObservedTaskList(
	list: Omit<TaskListView, "visibleTaskIds">,
	tasks: TaskWithPage[],
	pending: boolean,
	titleDrafts: Record<string, { title: string }>,
) {
	const observer = useTaskViewContext();
	const report = observer?.report;
	const selected =
		list.status === "ready"
			? tasks.find(
					(task) =>
						task.id === observer?.selectedTaskId &&
						!isOptimisticTaskId(task.id),
				)
			: undefined;
	const title = selected
		? (titleDrafts[selected.id]?.title ?? selected.title)
		: "";
	const serialized = report
		? JSON.stringify({
				list: {
					...list,
					visibleTaskIds:
						list.status === "ready"
							? tasks
									.filter((task) => !isOptimisticTaskId(task.id))
									.map((task) => task.id)
									.slice(0, 200)
							: [],
				},
				selectedTask: selected
					? {
							taskId: selected.id,
							pageId: selected.pageId,
							sourceBlockId: selected.sourceBlockId,
							title: title.slice(0, TASK_TITLE_MAX_LENGTH),
							completed: selected.completed,
							assigneeId: selected.assigneeId,
							dueDate: selected.dueDate,
							dueTime: selected.dueTime,
							reminderOffsetMinutes: selected.reminderOffsetMinutes,
						}
					: undefined,
				saveStatus:
					pending || (selected && title !== selected.title)
						? "unsaved"
						: "saved",
			})
		: "";
	useEffect(() => {
		if (report) report(list.view, JSON.parse(serialized));
	}, [report, list.view, serialized]);
	useEffect(() => () => report?.(list.view, undefined), [report, list.view]);
	return observer;
}

/** Mounted only by hosts that observe tasks. Normal web lists need no observer. */
export function TaskViewProvider({
	initialTaskId,
	onChange,
	children,
}: {
	initialTaskId?: string;
	onChange(value: TaskView | undefined): void;
	children: ReactNode;
}) {
	const [selectedTaskId, select] = useState(initialTaskId);
	const [reports, setReports] = useState<Record<string, ListReport>>({});
	const report = useCallback((key: string, value: ListReport | undefined) => {
		setReports((current) => {
			if (JSON.stringify(current[key]) === JSON.stringify(value))
				return current;
			const next = { ...current };
			if (value) next[key] = value;
			else delete next[key];
			return next;
		});
	}, []);
	useEffect(() => {
		const values = Object.values(reports);
		// Coalesce focus, query updates and optimistic changes into the latest view.
		const timer = setTimeout(
			() =>
				onChange({
					lists: values.map((value) => value.list),
					selectedTask: values.find(
						(value) => value.selectedTask?.taskId === selectedTaskId,
					)?.selectedTask,
					saveStatus: values.some((value) => value.saveStatus === "unsaved")
						? "unsaved"
						: !values.length ||
								values.some((value) => value.list.status !== "ready")
							? "unknown"
							: "saved",
				}),
			120,
		);
		return () => clearTimeout(timer);
	}, [reports, selectedTaskId, onChange]);
	useEffect(() => () => onChange(undefined), [onChange]);
	const value = useMemo(
		() => ({ selectedTaskId, select, report }),
		[selectedTaskId, report],
	);
	return (
		<TaskViewContext.Provider value={value}>
			{children}
		</TaskViewContext.Provider>
	);
}
