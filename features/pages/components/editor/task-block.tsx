"use client";

import { createExtension } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { DueDatePicker } from "@/components/due-date-picker";
import { AssigneePicker } from "@/features/members/components/assignee-picker";

export const taskBlockSpec = createReactBlockSpec(
	{
		type: "task",
		propSchema: {
			checked: { default: false },
			due: { default: "" },
			// Assigned member's user id; "" = unassigned. Reconciled into the
			// tasks table like checked/due.
			assignee: { default: "" },
		},
		content: "inline",
	},
	{
		render: ({ block, editor, contentRef }) => {
			const { checked, due, assignee } = block.props;
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
						className="ml-auto flex shrink-0 items-center gap-1"
					>
						<AssigneePicker
							value={assignee === "" ? null : assignee}
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
										? "text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 aria-expanded:opacity-100 [.haunter-task:hover_&]:opacity-100"
										: overdue
											? "bg-destructive/10 text-destructive"
											: "bg-muted text-muted-foreground"
								}`}
							/>
						)}
					</div>
				</div>
			);
		},
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
						return { type: "task", props: { checked: false } };
					},
				},
				{
					find: /^\s?\[[Xx]\]\s$/,
					replace() {
						return { type: "task", props: { checked: true } };
					},
				},
			],
		}),
	],
);
