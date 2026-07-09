"use client";

import { CalendarIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { formatDueDateLabel, parseIsoDate, toIsoDate } from "@/lib/due-date";
import { cn } from "@/lib/utils";

const Calendar = dynamic(
	() => import("@/components/ui/calendar").then((mod) => mod.Calendar),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-72 w-72 items-center justify-center text-muted-foreground text-sm">
				Loading…
			</div>
		),
	},
);

/**
 * Due-date chip that opens a calendar. `value` is a `YYYY-MM-DD` string or
 * null; the chip itself is styled by the caller via `className`.
 */
export function DueDatePicker({
	value,
	onChange,
	className,
	ariaLabel = "Due date",
}: {
	value: string | null;
	onChange: (next: string | null) => void;
	className?: string;
	ariaLabel?: string;
}) {
	const [open, setOpen] = useState(false);
	const selected = value ? parseIsoDate(value) : undefined;

	return (
		<Popover open={open} onOpenChange={setOpen}>
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
				<CalendarIcon className="size-3" aria-hidden="true" />
				{value ? formatDueDateLabel(value) : "Due"}
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="end">
				<Calendar
					mode="single"
					selected={selected}
					defaultMonth={selected}
					onSelect={(date) => {
						onChange(date ? toIsoDate(date) : null);
						setOpen(false);
					}}
				/>
				{value ? (
					<div className="border-t p-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="w-full text-muted-foreground"
							onClick={() => {
								onChange(null);
								setOpen(false);
							}}
						>
							Clear due date
						</Button>
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
