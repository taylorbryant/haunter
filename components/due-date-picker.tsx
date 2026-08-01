"use client";

import { BellIcon, CalendarIcon, ClockIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDeviceTime } from "@/components/device-time-provider";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
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
import { useIsMobile } from "@/hooks/use-mobile";
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
	{
		label: "Next weekend",
		date: (today) => addDays(today, ((6 - today.getDay() + 7) % 7) + 7),
	},
];

const MOBILE_DATE_PRESETS = DATE_PRESETS.filter(
	(preset) => preset.label !== "This weekend",
);

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
	const isMobile = useIsMobile();
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

	const trigger = (
		<button
			type="button"
			disabled={disabled}
			className={cn(
				"outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
				className,
			)}
			aria-label={accessibleName}
		>
			<CalendarIcon className="size-4 shrink-0" aria-hidden="true" />
			{value ? formatDueDateTimeLabel(value, time, today) : "Due"}
			{value && reminderOffsetMinutes !== null ? (
				<BellIcon className="size-3 shrink-0" aria-hidden="true" />
			) : null}
		</button>
	);

	const desktopPickerFields = (
		<>
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
		</>
	);

	const mobilePickerFields = (
		<>
			<div className="flex flex-col divide-y divide-border/70">
				{MOBILE_DATE_PRESETS.map((preset) => {
					const date = preset.date(today);
					const iso = toIsoDate(date);
					return (
						<button
							key={preset.label}
							type="button"
							aria-pressed={draft.date === iso}
							className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-base outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
							onClick={() => changeDate(date)}
						>
							<span className="font-medium">{preset.label}</span>
							<span className="shrink-0 text-muted-foreground text-sm">
								{date.toLocaleDateString(undefined, { weekday: "short" })}
							</span>
						</button>
					);
				})}
				<button
					type="button"
					aria-pressed={draft.date === null}
					className="flex min-h-12 w-full items-center px-4 py-2.5 text-left font-medium text-base outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
					onClick={() =>
						changeDraft({
							date: null,
							time: null,
							reminderOffsetMinutes: null,
						})
					}
				>
					No date
				</button>
			</div>
			<Separator />
			<Calendar
				mode="single"
				selected={selected}
				month={visibleMonth}
				onMonthChange={setVisibleMonth}
				onSelect={changeDate}
				className="w-full px-4 py-3"
			/>
			<div className="border-t">
				<div className="flex min-h-14 min-w-0 items-center gap-3 px-4 py-2">
					<ClockIcon
						className="size-4 shrink-0 stroke-muted-foreground"
						aria-hidden="true"
					/>
					<span className="min-w-0 flex-1 font-medium text-base">Time</span>
					<input
						type="time"
						name="mobileDueTime"
						value={draft.time ?? ""}
						disabled={!draft.date}
						aria-label="Due time"
						className="min-h-9 w-32 rounded-md border bg-transparent px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
						onChange={(event) =>
							changeDraft({
								date: draft.date,
								time: event.target.value || null,
								reminderOffsetMinutes: draft.reminderOffsetMinutes,
							})
						}
					/>
					{draft.time ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							disabled={!draft.date}
							aria-label="Clear due time"
							className="relative"
							onClick={() =>
								changeDraft({
									date: draft.date,
									time: null,
									reminderOffsetMinutes: draft.reminderOffsetMinutes,
								})
							}
						>
							<XIcon className="size-4" aria-hidden="true" />
							<span
								className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
								aria-hidden="true"
							/>
						</Button>
					) : null}
				</div>
				<div className="flex min-h-14 items-center gap-3 border-t px-4 py-2">
					<BellIcon
						className="size-4 shrink-0 stroke-muted-foreground"
						aria-hidden="true"
					/>
					<span className="min-w-0 flex-1 font-medium text-base">Reminder</span>
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
							className="max-w-52 border-0 bg-transparent shadow-none"
							aria-label="Task reminder"
						>
							<SelectValue placeholder="No reminder" />
						</SelectTrigger>
						<SelectContent align="end" alignItemWithTrigger={false}>
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
			</div>
		</>
	);

	const pickerActions = (
		<>
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
		</>
	);

	if (isMobile) {
		return (
			<Drawer showSwipeHandle open={open} onOpenChange={changeOpen}>
				<DrawerTrigger render={trigger} />
				<DrawerContent className="h-[90dvh] max-h-[90dvh]">
					<DrawerHeader className="border-b px-4 pb-3 text-left">
						<DrawerTitle>Date</DrawerTitle>
						<DrawerDescription className="sr-only">
							Choose a due date, time, and reminder
						</DrawerDescription>
					</DrawerHeader>
					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
						{mobilePickerFields}
					</div>
					<div className="flex shrink-0 items-center justify-end border-t p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => changeOpen(false)}
						>
							Done
						</Button>
					</div>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Popover open={open} onOpenChange={changeOpen}>
			<PopoverTrigger render={trigger} />
			<PopoverContent
				className="w-auto max-w-[calc(100vw-1rem)] p-0"
				align="end"
			>
				{desktopPickerFields}
				<div className="flex items-center justify-between border-t p-2">
					{pickerActions}
				</div>
			</PopoverContent>
		</Popover>
	);
}
