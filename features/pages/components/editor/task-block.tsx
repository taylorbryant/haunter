"use client";

import { createExtension } from "@blocknote/core";
import {
	createReactBlockSpec,
	type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import { createContext, useContext } from "react";
import { DueDatePicker } from "@/components/due-date-picker";
import { AssigneePicker } from "@/features/members/components/assignee-picker";
import { AUTO_TASK_ASSIGNEE } from "@/features/tasks/lib/task-block-props";

export const TaskBlockCurrentUserContext = createContext<string | null>(null);

const taskBlockConfig = {
	type: "task",
	propSchema: {
		checked: { default: false },
		due: { default: "" },
		// Assigned member's user id. AUTO_TASK_ASSIGNEE means "default to
		// whoever creates/saves this new block"; "" is explicitly unassigned.
		assignee: { default: AUTO_TASK_ASSIGNEE },
	},
	content: "inline",
} as const;

function TaskBlockView({
	block,
	editor,
	contentRef,
}: ReactCustomBlockRenderProps<typeof taskBlockConfig>) {
	const { checked, due, assignee } = block.props;
	const currentUserId = useContext(TaskBlockCurrentUserContext);
	const shownAssignee =
		assignee === AUTO_TASK_ASSIGNEE ? (currentUserId ?? "") : assignee;
	// BlockNote's editable=false stops text editing, but this custom
	// checkbox/date UI fires its own handlers — gate them too so a
	// read-only viewer can't toggle props.
	const readOnly = !editor.isEditable;

	function update(props: {
		checked?: boolean;
		due?: string;
		assignee?: string;
	}) {
		if (!editor.isEditable) return;
		editor.updateBlock(block, {
			props: { ...block.props, ...props },
		});
	}

	const overdue =
		due !== "" && !checked && due < new Date().toISOString().slice(0, 10);

	return (
		// flex-wrap + the content's flex-basis floor: on narrow screens
		// the chip group drops to its own right-aligned line instead of
		// squeezing the task text into a sliver.
		<div className="haunter-task flex w-full flex-wrap items-start gap-2">
			<input
				type="checkbox"
				checked={checked}
				disabled={readOnly}
				onChange={(event) => update({ checked: event.target.checked })}
				className={`mt-1 size-4 shrink-0 accent-primary ${readOnly ? "" : "cursor-pointer"}`}
				aria-label={checked ? "Mark task open" : "Mark task done"}
			/>
			<div
				ref={contentRef}
				className={
					checked
						? "min-w-0 flex-1 basis-48 text-muted-foreground line-through"
						: "min-w-0 flex-1 basis-48"
				}
			/>
			<div
				contentEditable={false}
				// Mobile: a full-width row below the title, left-aligned and
				// indented past the checkbox (like the Tasks page). sm+: inline
				// on the right of the title.
				className="flex w-full shrink-0 items-center gap-1 pl-6 sm:ml-auto sm:w-auto sm:pl-0"
			>
				<AssigneePicker
					value={shownAssignee === "" ? null : shownAssignee}
					disabled={readOnly}
					onChange={(next) => update({ assignee: next ?? "" })}
				/>
				{readOnly && due === "" ? null : readOnly ? (
					<span
						className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ${
							overdue
								? "bg-destructive/10 text-destructive"
								: "bg-muted text-muted-foreground"
						}`}
					>
						{due}
					</span>
				) : (
					<DueDatePicker
						value={due === "" ? null : due}
						onChange={(next) => update({ due: next ?? "" })}
						className={`flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ${
							due === ""
								? "text-muted-foreground/70 hover:bg-muted focus-visible:bg-muted aria-expanded:bg-muted"
								: overdue
									? "bg-destructive/10 text-destructive"
									: "bg-muted text-muted-foreground"
						}`}
					/>
				)}
			</div>
		</div>
	);
}

export const taskBlockSpec = createReactBlockSpec(
	taskBlockConfig,
	{
		render: TaskBlockView,
	},
	// Markdown-style shortcuts: typing "[] " or "[x] " converts the block to a
	// task, mirroring BlockNote's built-in checkListItem rules.
	[
		createExtension({
			key: "task-shortcuts",
			inputRules: [
				{
					find: /^\s?\[\s*\]\s$/,
					replace() {
						return {
							type: "task",
							props: { checked: false, assignee: AUTO_TASK_ASSIGNEE },
						};
					},
				},
				{
					find: /^\s?\[[Xx]\]\s$/,
					replace() {
						return {
							type: "task",
							props: { checked: true, assignee: AUTO_TASK_ASSIGNEE },
						};
					},
				},
			],
		}),
	],
);
