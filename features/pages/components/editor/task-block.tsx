"use client";

import { createExtension } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { DueDatePicker } from "@/components/due-date-picker";

export const taskBlockSpec = createReactBlockSpec(
	{
		type: "task",
		propSchema: {
			checked: { default: false },
			due: { default: "" },
		},
		content: "inline",
	},
	{
		render: ({ block, editor, contentRef }) => {
			const { checked, due } = block.props;

			function update(props: { checked?: boolean; due?: string }) {
				editor.updateBlock(block, {
					props: { ...block.props, ...props },
				});
			}

			const overdue =
				due !== "" && !checked && due < new Date().toISOString().slice(0, 10);

			return (
				<div className="haunter-task flex w-full items-start gap-2">
					<input
						type="checkbox"
						checked={checked}
						onChange={(event) => update({ checked: event.target.checked })}
						className="mt-1 size-4 shrink-0 cursor-pointer accent-primary"
						aria-label={checked ? "Mark task open" : "Mark task done"}
					/>
					<div
						ref={contentRef}
						className={
							checked
								? "min-w-0 flex-1 text-muted-foreground line-through"
								: "min-w-0 flex-1"
						}
					/>
					<div contentEditable={false} className="shrink-0">
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
