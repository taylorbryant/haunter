"use client";

import { BellIcon, CalendarIcon, ClockIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDeviceTime } from "@/components/device-time-provider";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatDueDatePickerAccessibleName } from "@/features/tasks/lib/due-date-accessibility";
import {
	formatTaskReminderLabel,
	parseTaskReminderOffset,
	TASK_REMINDER_OPTIONS,
	type TaskReminderOffsetMinutes,
} from "@/features/tasks/lib/reminder-options";
import {
	formatDueDateLabel,
	formatDueDateTimeLabel,
	parseIsoDate,
	toIsoDate,
} from "@/lib/due-date";
import { cn } from "@/lib/utils";

export type DueDateValue = {
	date: string | null;
	time: string | null;
	reminderOffsetMinutes: TaskReminderOffsetMinutes;
};

function addDays(from: Date, days: number): Date {
	const date = new Date(from);
	date.setDate(date.getDate() + days);
	return date;
}

const DATE_PRESETS: { label: string; date: (today: Date) => Date }[] = [
	{ label: "Today", date: (today) => addDays(today, 0) },
	{ label: "Tomorrow", date: (today) => addDays(today, 1) },
	{
		label: "This weekend",
		date: (today) => addDays(today, (6 - today.getDay() + 7) % 7),
	},
	{
		label: "Next week",
		date: (today) => addDays(today, (1 - today.getDay() + 7) % 7 || 7),
	},
];

const TIME_PRESETS = [
	{ label: "9 AM", value: "09:00" },
	{ label: "Noon", value: "12:00" },
	{ label: "3 PM", value: "15:00" },
	{ label: "6 PM", value: "18:00" },
] as const;

/** Shared due-date chip with presets, a calendar, and an optional local time. */
export function DueDatePicker({
	value,
	time = null,
	reminderOffsetMinutes = null,
	onChange,
	className,
	ariaLabel = "Due date, time, and reminder",
	disabled = false,
}: {
	value: string | null;
	time?: string | null;
	reminderOffsetMinutes?: TaskReminderOffsetMinutes;
	onChange: (next: DueDateValue) => void;
	className?: string;
	ariaLabel?: string;
	disabled?: boolean;
}) {
	const deviceTime = useDeviceTime();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<DueDateValue>({
		date: value,
		time,
		reminderOffsetMinutes,
	});
	const draftRef = useRef(draft);
	const dirtyRef = useRef(false);
	const selected = draft.date ? parseIsoDate(draft.date) : undefined;
	const today = deviceTime.ready ? parseIsoDate(deviceTime.today) : null;
	const [visibleMonth, setVisibleMonth] = useState<Date | undefined>(selected);
	const accessibleName = formatDueDatePickerAccessibleName({
		action: ariaLabel,
		dueDate: value,
		dueTime: time,
		reminderOffsetMinutes,
		today: deviceTime.ready ? deviceTime.today : null,
		loading: !deviceTime.ready,
		disabled: disabled || !deviceTime.ready,
	});

	useEffect(() => {
		if (!disabled) return;
		dirtyRef.current = false;
		setOpen(false);
	}, [disabled]);

	function changeOpen(nextOpen: boolean) {
		if (disabled) {
			dirtyRef.current = false;
			setOpen(false);
			return;
		}
		if (nextOpen && today) {
			const nextDraft = { date: value, time, reminderOffsetMinutes };
			draftRef.current = nextDraft;
			setDraft(nextDraft);
			setVisibleMonth(value ? parseIsoDate(value) : today);
			dirtyRef.current = false;
		} else if (!nextOpen) {
			setOpen(false);
			const latestDraft = draftRef.current;
			const shouldApply =
				dirtyRef.current &&
				(latestDraft.date !== value ||
					latestDraft.time !== time ||
					latestDraft.reminderOffsetMinutes !== reminderOffsetMinutes);
			dirtyRef.current = false;
			if (shouldApply) onChange(latestDraft);
			return;
		}
		setOpen(nextOpen);
	}

	function changeDraft(next: DueDateValue) {
		if (disabled) return;
		dirtyRef.current = true;
		draftRef.current = next;
		setDraft(next);
	}

	function changeDate(date: Date | undefined) {
		if (date) setVisibleMonth(date);
		changeDraft({
			date: date ? toIsoDate(date) : null,
			time: date ? draft.time : null,
			reminderOffsetMinutes: date ? draft.reminderOffsetMinutes : null,
		});
	}

	if (!today) {
		return (
			<button
				type="button"
				disabled
				aria-busy="true"
				aria-label={accessibleName}
				className={cn(
					"outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
					className,
				)}
			>
				<CalendarIcon className="size-4 shrink-0" aria-hidden="true" />
				{value ? "Loading…" : "Due"}
			</button>
		);
	}

	return (
		<Popover open={open} onOpenChange={changeOpen}>
			<PopoverTrigger
				render={
					<button
						type="button"
						disabled={disabled}
						className={cn(
							"outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
							className,
						)}
						aria-label={accessibleName}
					/>
				}
			>
				<CalendarIcon className="size-4 shrink-0" aria-hidden="true" />
				{value ? formatDueDateTimeLabel(value, time, today) : "Due"}
				{value && reminderOffsetMinutes !== null ? (
					<BellIcon className="size-3 shrink-0" aria-hidden="true" />
				) : null}
			</PopoverTrigger>
			<PopoverContent
				className="w-auto max-w-[calc(100vw-1rem)] p-0"
				align="end"
			>
				<div className="flex min-w-0 flex-col sm:flex-row">
					<Calendar
						mode="single"
						selected={selected}
						month={visibleMonth}
						onMonthChange={setVisibleMonth}
						onSelect={changeDate}
						className="w-full sm:w-fit"
					/>
					<div className="flex min-w-36 flex-col gap-0.5 border-t p-2 sm:border-t-0 sm:border-l">
						{DATE_PRESETS.map((preset) => {
							const date = preset.date(today);
							const iso = toIsoDate(date);
							return (
								<Button
									key={preset.label}
									type="button"
									variant={draft.date === iso ? "secondary" : "ghost"}
									size="sm"
									className="justify-between gap-3 font-normal"
									onClick={() => changeDate(date)}
								>
									{preset.label}
									<span className="text-muted-foreground text-xs">
										{formatDueDateLabel(iso, today) === preset.label
											? date.toLocaleDateString(undefined, {
													weekday: "short",
												})
											: formatDueDateLabel(iso, today)}
									</span>
								</Button>
							);
						})}
					</div>
				</div>
				<Separator />
				<div className="flex flex-col gap-2 p-2">
					<div className="flex min-w-0 items-center gap-2">
						<ClockIcon
							className="size-4 shrink-0 stroke-muted-foreground"
							aria-hidden="true"
						/>
						<input
							type="time"
							name="dueTime"
							value={draft.time ?? ""}
							disabled={!draft.date}
							aria-label="Due time"
							className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
							onChange={(event) =>
								changeDraft({
									date: draft.date,
									time: event.target.value || null,
									reminderOffsetMinutes: draft.reminderOffsetMinutes,
								})
							}
						/>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={!draft.date || draft.time === null}
							onClick={() =>
								changeDraft({
									date: draft.date,
									time: null,
									reminderOffsetMinutes: draft.reminderOffsetMinutes,
								})
							}
						>
							No time
						</Button>
					</div>
					<div className="flex flex-wrap gap-1 pl-6">
						{TIME_PRESETS.map((preset) => (
							<Button
								key={preset.value}
								type="button"
								variant={draft.time === preset.value ? "secondary" : "ghost"}
								size="sm"
								disabled={!draft.date}
								onClick={() =>
									changeDraft({
										date: draft.date,
										time: preset.value,
										reminderOffsetMinutes: draft.reminderOffsetMinutes,
									})
								}
							>
								{preset.label}
							</Button>
						))}
					</div>
				</div>
				<div className="flex items-center gap-2 border-t p-2">
					<BellIcon
						className="size-4 shrink-0 stroke-muted-foreground"
						aria-hidden="true"
					/>
					<Select
						items={TASK_REMINDER_OPTIONS.map((option) => ({
							label:
								option.value === "0" && draft.time === null
									? formatTaskReminderLabel(0, null)
									: option.label,
							value: option.value,
						}))}
						value={
							draft.reminderOffsetMinutes === null
								? "none"
								: String(draft.reminderOffsetMinutes)
						}
						disabled={!draft.date}
						onValueChange={(next) =>
							changeDraft({
								...draft,
								reminderOffsetMinutes:
									next === null ? null : parseTaskReminderOffset(next),
							})
						}
					>
						<SelectTrigger
							size="sm"
							className="w-full border-0 bg-transparent shadow-none"
							aria-label="Task reminder"
						>
							<SelectValue placeholder="No reminder" />
						</SelectTrigger>
						<SelectContent align="start" alignItemWithTrigger={false}>
							{TASK_REMINDER_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.value === "0" && draft.time === null
										? formatTaskReminderLabel(0, null)
										: option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center justify-between border-t p-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={!draft.date}
						onClick={() =>
							changeDraft({
								date: null,
								time: null,
								reminderOffsetMinutes: null,
							})
						}
					>
						Clear
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => changeOpen(false)}
					>
						Done
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
