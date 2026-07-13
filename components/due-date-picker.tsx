"use client";

import { CalendarIcon, ClockIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
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
};

function addDays(days: number): Date {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return date;
}

const DATE_PRESETS: { label: string; date: () => Date }[] = [
	{ label: "Today", date: () => addDays(0) },
	{ label: "Tomorrow", date: () => addDays(1) },
	{
		label: "This weekend",
		date: () => addDays((6 - new Date().getDay() + 7) % 7),
	},
	{
		label: "Next week",
		date: () => addDays((1 - new Date().getDay() + 7) % 7 || 7),
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
	onChange,
	className,
	ariaLabel = "Due date and time",
}: {
	value: string | null;
	time?: string | null;
	onChange: (next: DueDateValue) => void;
	className?: string;
	ariaLabel?: string;
}) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<DueDateValue>({ date: value, time });
	const selected = draft.date ? parseIsoDate(draft.date) : undefined;
	const [visibleMonth, setVisibleMonth] = useState<Date | undefined>(selected);

	function changeOpen(nextOpen: boolean) {
		if (nextOpen) {
			setDraft({ date: value, time });
			setVisibleMonth(value ? parseIsoDate(value) : new Date());
		}
		setOpen(nextOpen);
	}

	function changeDate(date: Date | undefined) {
		if (date) setVisibleMonth(date);
		setDraft({
			date: date ? toIsoDate(date) : null,
			time: date ? draft.time : null,
		});
	}

	function applyDraft() {
		setOpen(false);
		if (draft.date !== value || draft.time !== time) {
			onChange(draft);
		}
	}

	return (
		<Popover open={open} onOpenChange={changeOpen}>
			<PopoverTrigger
				render={
					<button
						type="button"
						className={cn(
							"outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
							className,
						)}
						aria-label={ariaLabel}
					/>
				}
			>
				<CalendarIcon className="size-4 shrink-0" aria-hidden="true" />
				{value ? formatDueDateTimeLabel(value, time) : "Due"}
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
					/>
					<div className="flex min-w-36 flex-col gap-0.5 border-t p-2 sm:border-t-0 sm:border-l">
						{DATE_PRESETS.map((preset) => {
							const date = preset.date();
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
										{formatDueDateLabel(iso) === preset.label
											? date.toLocaleDateString(undefined, {
													weekday: "short",
												})
											: formatDueDateLabel(iso)}
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
								setDraft({
									date: draft.date,
									time: event.target.value || null,
								})
							}
						/>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={!draft.date || draft.time === null}
							onClick={() => setDraft({ date: draft.date, time: null })}
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
									setDraft({ date: draft.date, time: preset.value })
								}
							>
								{preset.label}
							</Button>
						))}
					</div>
				</div>
				<div className="flex items-center justify-between border-t p-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={!draft.date}
						onClick={() => setDraft({ date: null, time: null })}
					>
						Clear
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={applyDraft}
					>
						Done
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
