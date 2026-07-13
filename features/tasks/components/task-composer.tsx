"use client";

import { CalendarIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DueDatePicker, type DueDateValue } from "@/components/due-date-picker";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AssigneePicker } from "@/features/members/components/assignee-picker";
import {
	humanizeDueDate,
	parseTaskInput,
} from "@/features/tasks/lib/parse-task-input";
import { cn } from "@/lib/utils";

/**
 * Todoist-style inline composer: natural-language dates are highlighted in
 * the title and prefill the date chip; the chip's picker offers presets.
 */
export function TaskComposer({
	currentUserId,
	onSubmit,
	onCancel,
	defaultDueDate = null,
	mode = "full",
}: {
	currentUserId: string | null;
	onSubmit: (input: {
		title: string;
		dueDate: string | null;
		dueTime: string | null;
		assigneeId?: string | null;
	}) => Promise<boolean>;
	onCancel?: () => void;
	defaultDueDate?: string | null;
	mode?: "full" | "compact";
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [text, setText] = useState("");
	// Undefined means untouched, so a parsed phrase can override the contextual
	// default. Null means the user explicitly cleared the date.
	const [manualDue, setManualDue] = useState<DueDateValue | undefined>();
	// Set when the user dismisses a detected phrase so it stays dismissed.
	const [ignoredMatchText, setIgnoredMatchText] = useState<string | null>(null);
	const [assigneeId, setAssigneeId] = useState<string | null>(currentUserId);
	const [assigneeTouched, setAssigneeTouched] = useState(false);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		if (!assigneeTouched) setAssigneeId(currentUserId);
	}, [assigneeTouched, currentUserId]);

	const parsed = parseTaskInput(text);
	const activeMatch =
		parsed.match && parsed.match.text !== ignoredMatchText
			? parsed.match
			: null;
	// A manually picked date wins over the parsed one.
	const dueDate =
		manualDue !== undefined
			? manualDue.date
			: activeMatch
				? parsed.dueDate
				: defaultDueDate;
	const dueTime =
		manualDue !== undefined
			? manualDue.time
			: activeMatch
				? parsed.dueTime
				: null;
	const title = activeMatch ? parsed.title : text.trim();

	async function submit() {
		if (!title || pending) return;
		setPending(true);
		const submitAssigneeId =
			assigneeTouched || assigneeId !== null ? assigneeId : undefined;
		const ok = await onSubmit({
			title,
			dueDate,
			dueTime,
			...(submitAssigneeId !== undefined
				? { assigneeId: submitAssigneeId }
				: {}),
		});
		setPending(false);
		if (ok) {
			setText("");
			setManualDue(undefined);
			setIgnoredMatchText(null);
			setAssigneeId(currentUserId);
			setAssigneeTouched(false);
			inputRef.current?.focus();
		}
	}

	function clearDate() {
		setManualDue({ date: null, time: null });
		if (activeMatch) setIgnoredMatchText(activeMatch.text);
		else setIgnoredMatchText(null);
	}

	if (mode === "compact") {
		return (
			<div className="flex min-w-0 items-center gap-2 border-b py-2">
				<div className="relative min-w-0 flex-1">
					{activeMatch ? (
						<div
							aria-hidden
							className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre font-medium text-base text-foreground leading-6 sm:text-sm"
						>
							{text.slice(0, activeMatch.index)}
							<span className="-mx-0.5 rounded-sm bg-primary/10 px-0.5 py-0.5">
								{activeMatch.text}
							</span>
							{text.slice(activeMatch.index + activeMatch.text.length)}
						</div>
					) : null}
					<input
						ref={inputRef}
						value={text}
						placeholder="Add a task for today…"
						aria-label="Add a task"
						className={cn(
							"keyboard-focus-ring relative w-full rounded-sm bg-transparent font-medium text-base leading-6 outline-none [--keyboard-focus-ring-size:2px] placeholder:text-muted-foreground sm:text-sm",
							activeMatch && "text-transparent caret-foreground",
						)}
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") submit();
						}}
					/>
				</div>
				{dueDate ? (
					<span className="hidden shrink-0 items-center gap-1 text-muted-foreground text-xs sm:flex">
						<CalendarIcon className="size-3.5" aria-hidden="true" />
						{dueDate === defaultDueDate && dueTime === null
							? "Today"
							: humanizeDueDate(dueDate, dueTime)}
					</span>
				) : null}
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={pending ? "Adding task" : "Add task"}
					disabled={!title || pending}
					onClick={submit}
				>
					<PlusIcon />
				</Button>
			</div>
		);
	}

	return (
		<div className="rounded-xl border">
			<div className="flex flex-col gap-2 p-3">
				<div className="relative">
					{activeMatch ? (
						// Mirror behind a transparent-text input renders the
						// Todoist-style highlight on the matched date phrase.
						<div
							aria-hidden
							className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre font-medium text-base text-foreground leading-6 sm:text-sm"
						>
							{text.slice(0, activeMatch.index)}
							{/* Padding must be cancelled by negative margin so glyphs never
							    shift (the mirror stays caret-aligned with the input). The
							    pill and its gap to neighboring words share one space char
							    (~4.5px): a 2px overhang leaves a ~2.5px visible gap. */}
							<span className="-mx-0.5 rounded-sm bg-primary/10 px-0.5 py-0.5">
								{activeMatch.text}
							</span>
							{text.slice(activeMatch.index + activeMatch.text.length)}
						</div>
					) : null}
					<input
						ref={inputRef}
						// biome-ignore lint/a11y/noAutofocus: full composer opens after an explicit user action
						autoFocus={mode === "full"}
						value={text}
						placeholder="Task name, e.g. “pick up meds tomorrow at 2”"
						aria-label="Task name"
						className={cn(
							"keyboard-focus-ring relative w-full rounded-sm bg-transparent font-medium text-base leading-6 outline-none [--keyboard-focus-ring-size:2px] placeholder:text-muted-foreground sm:text-sm",
							activeMatch && "text-transparent caret-foreground",
						)}
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") submit();
							if (event.key === "Escape") onCancel?.();
						}}
					/>
				</div>
				<div className="flex items-center gap-1.5">
					<AssigneePicker
						value={assigneeId}
						label={assigneeId ? "Assigned" : null}
						onChange={(next) => {
							setAssigneeTouched(true);
							setAssigneeId(next);
						}}
						className="opacity-100 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
					/>
					<DueDatePicker
						value={dueDate}
						time={dueTime}
						onChange={(next) => {
							setManualDue(next);
							if (next.date === null && activeMatch) {
								setIgnoredMatchText(activeMatch.text);
							}
						}}
						className={cn(
							"flex items-center gap-1.5 rounded-md border py-1 pr-2 pl-1 text-xs",
							dueDate
								? "text-foreground"
								: "text-muted-foreground hover:bg-muted",
						)}
					/>
					{dueDate ? (
						<button
							type="button"
							aria-label="Remove due date"
							className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
							onClick={clearDate}
						>
							<XIcon className="size-3" aria-hidden="true" />
						</button>
					) : null}
				</div>
			</div>
			<Separator />
			<div className="flex items-center justify-end gap-2 p-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => onCancel?.()}
				>
					Cancel
				</Button>
				<Button
					type="button"
					size="sm"
					disabled={!title || pending}
					onClick={submit}
				>
					{pending ? "Adding…" : "Add task"}
				</Button>
			</div>
		</div>
	);
}
