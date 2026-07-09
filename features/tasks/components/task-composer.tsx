"use client";

import { CalendarIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { AssigneePicker } from "@/features/members/components/assignee-picker";
import {
	humanizeDueDate,
	parseTaskInput,
	toIsoDate,
} from "@/features/tasks/lib/parse-task-input";
import { cn } from "@/lib/utils";

function addDays(days: number): Date {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return date;
}

const PRESETS: { label: string; date: () => Date }[] = [
	{ label: "Today", date: () => addDays(0) },
	{ label: "Tomorrow", date: () => addDays(1) },
	{
		label: "This weekend",
		// Next Saturday (or today if it is Saturday).
		date: () => addDays((6 - new Date().getDay() + 7) % 7),
	},
	{
		label: "Next week",
		// Next Monday.
		date: () => addDays((1 - new Date().getDay() + 7) % 7 || 7),
	},
];

/**
 * Todoist-style inline composer: natural-language dates are highlighted in
 * the title and prefill the date chip; the chip's picker offers presets.
 */
export function TaskComposer({
	currentUserId,
	onSubmit,
	onCancel,
}: {
	currentUserId: string | null;
	onSubmit: (input: {
		title: string;
		dueDate: string | null;
		assigneeId?: string | null;
	}) => Promise<boolean>;
	onCancel: () => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [text, setText] = useState("");
	const [manualDate, setManualDate] = useState<string | null>(null);
	// Set when the user dismisses a detected phrase so it stays dismissed.
	const [ignoredMatchText, setIgnoredMatchText] = useState<string | null>(null);
	const [assigneeId, setAssigneeId] = useState<string | null>(currentUserId);
	const [assigneeTouched, setAssigneeTouched] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
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
	const dueDate = manualDate ?? (activeMatch ? parsed.dueDate : null);
	const title = activeMatch ? parsed.title : text.trim();

	async function submit() {
		if (!title || pending) return;
		setPending(true);
		const submitAssigneeId =
			assigneeTouched || assigneeId !== null ? assigneeId : undefined;
		const ok = await onSubmit({
			title,
			dueDate,
			...(submitAssigneeId !== undefined
				? { assigneeId: submitAssigneeId }
				: {}),
		});
		setPending(false);
		if (ok) {
			setText("");
			setManualDate(null);
			setIgnoredMatchText(null);
			setAssigneeId(currentUserId);
			setAssigneeTouched(false);
			inputRef.current?.focus();
		}
	}

	function clearDate() {
		setManualDate(null);
		if (activeMatch) setIgnoredMatchText(activeMatch.text);
		else setIgnoredMatchText(null);
	}

	function pickDate(date: Date | undefined) {
		setManualDate(date ? toIsoDate(date) : null);
		setPickerOpen(false);
		inputRef.current?.focus();
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
						// biome-ignore lint/a11y/noAutofocus: the composer is opened by an explicit user action
						autoFocus
						value={text}
						placeholder="Task name, e.g. “buy groceries tomorrow”"
						aria-label="Task name"
						className={cn(
							"keyboard-focus-ring relative w-full rounded-sm bg-transparent font-medium text-base leading-6 outline-none [--keyboard-focus-ring-size:2px] placeholder:text-muted-foreground sm:text-sm",
							activeMatch && "text-transparent caret-foreground",
						)}
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") submit();
							if (event.key === "Escape") onCancel();
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
					<Popover open={pickerOpen} onOpenChange={setPickerOpen}>
						<PopoverTrigger
							render={
								<button
									type="button"
									className={cn(
										"flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
										dueDate
											? "text-foreground"
											: "text-muted-foreground hover:bg-muted",
									)}
								>
									<CalendarIcon className="size-3.5" aria-hidden="true" />
									{dueDate ? humanizeDueDate(dueDate) : "Date"}
								</button>
							}
						/>
						<PopoverContent className="w-auto p-0" align="start">
							<div className="flex flex-col gap-0.5 p-2">
								{PRESETS.map((preset) => (
									<Button
										key={preset.label}
										type="button"
										variant="ghost"
										size="sm"
										className="justify-start font-normal"
										onClick={() => pickDate(preset.date())}
									>
										{preset.label}
										<span className="ml-auto text-muted-foreground text-xs">
											{humanizeDueDate(toIsoDate(preset.date())) ===
											preset.label
												? preset.date().toLocaleDateString(undefined, {
														weekday: "short",
													})
												: humanizeDueDate(toIsoDate(preset.date()))}
										</span>
									</Button>
								))}
							</div>
							<Separator />
							<Calendar
								mode="single"
								selected={
									dueDate
										? new Date(
												Number(dueDate.slice(0, 4)),
												Number(dueDate.slice(5, 7)) - 1,
												Number(dueDate.slice(8, 10)),
											)
										: undefined
								}
								defaultMonth={
									dueDate
										? new Date(
												Number(dueDate.slice(0, 4)),
												Number(dueDate.slice(5, 7)) - 1,
											)
										: undefined
								}
								onSelect={pickDate}
							/>
						</PopoverContent>
					</Popover>
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
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
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
