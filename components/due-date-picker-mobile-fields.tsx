import { BellIcon, ClockIcon, XIcon } from "lucide-react";
import type { DueDateValue } from "@/components/due-date-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
	formatTaskReminderLabel,
	parseTaskReminderOffset,
	TASK_REMINDER_OPTIONS,
} from "@/features/tasks/lib/reminder-options";
import { parseIsoDate, toIsoDate } from "@/lib/due-date";

export type MobileDatePreset = {
	label: string;
	date: Date;
};

export function MobileDueDatePickerFields({
	draft,
	visibleMonth,
	presets,
	onDraftChange,
	onVisibleMonthChange,
	onDone,
}: {
	draft: DueDateValue;
	visibleMonth: Date | undefined;
	presets: MobileDatePreset[];
	onDraftChange: (draft: DueDateValue) => void;
	onVisibleMonthChange: (month: Date) => void;
	onDone: () => void;
}) {
	function changeDate(date: Date | undefined) {
		if (date) onVisibleMonthChange(date);
		onDraftChange({
			date: date ? toIsoDate(date) : null,
			time: date ? draft.time : null,
			reminderOffsetMinutes: date ? draft.reminderOffsetMinutes : null,
		});
	}

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<div className="flex flex-col divide-y divide-border/70">
					{presets.map((preset) => {
						const iso = toIsoDate(preset.date);
						return (
							<button
								key={preset.label}
								type="button"
								aria-pressed={draft.date === iso}
								className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-base outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
								onClick={() => changeDate(preset.date)}
							>
								<span className="font-medium">{preset.label}</span>
								<span className="shrink-0 text-muted-foreground text-sm">
									{preset.date.toLocaleDateString(undefined, {
										weekday: "short",
									})}
								</span>
							</button>
						);
					})}
					<button
						type="button"
						aria-pressed={draft.date === null}
						className="flex min-h-12 w-full items-center px-4 py-2.5 text-left font-medium text-base outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
						onClick={() =>
							onDraftChange({
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
					selected={draft.date ? parseIsoDate(draft.date) : undefined}
					month={visibleMonth}
					onMonthChange={onVisibleMonthChange}
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
								onDraftChange({
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
									onDraftChange({
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
						<span className="min-w-0 flex-1 font-medium text-base">
							Reminder
						</span>
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
								onDraftChange({
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
			</div>
			<div className="flex shrink-0 items-center justify-end border-t p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
				<Button type="button" variant="secondary" size="sm" onClick={onDone}>
					Done
				</Button>
			</div>
		</>
	);
}
