"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Parse a stored `YYYY-MM-DD` string as a local date. */
function toDate(value: string): Date | undefined {
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return undefined;
	return new Date(year, month - 1, day);
}

function toIsoDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

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
	const selected = value ? toDate(value) : undefined;

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
				{value ?? "Due"}
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
