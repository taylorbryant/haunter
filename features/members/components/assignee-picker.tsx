"use client";

import { CircleUserRoundIcon } from "lucide-react";
import { authClient } from "@/client/auth-client";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function initials(text: string) {
	return text.trim().slice(0, 2).toUpperCase();
}

/**
 * Compact assignee chip + member dropdown. `value` is a user id or null.
 * Renders a static chip when `disabled` (viewers) and an invisible-until-
 * hover "assign" affordance when unassigned, mirroring the due-date chip.
 */
export function AssigneePicker({
	value,
	onChange,
	disabled = false,
	className,
}: {
	value: string | null;
	onChange: (next: string | null) => void;
	disabled?: boolean;
	className?: string;
}) {
	const orgQuery = authClient.useActiveOrganization();
	const members = orgQuery.data?.members ?? [];
	const current = members.find((member) => member.userId === value) ?? null;
	const label = current
		? current.user?.name || current.user?.email || "Member"
		: null;

	const chip = label ? (
		<span className="flex items-center gap-1">
			<span className="flex size-4 items-center justify-center rounded-full bg-primary/15 text-[9px] text-primary leading-none">
				{initials(label)}
			</span>
			<span className="max-w-24 truncate">{label}</span>
		</span>
	) : (
		<span className="flex items-center gap-1">
			<CircleUserRoundIcon className="size-3" />
			Assign
		</span>
	);

	if (disabled) {
		// Viewers: show who owns it, nothing clickable; hide when unassigned.
		return label ? (
			<span
				className={cn(
					"flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground text-xs",
					className,
				)}
			>
				{chip}
			</span>
		) : null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-label={label ? `Assigned to ${label}` : "Assign"}
						className={cn(
							"flex shrink-0 cursor-pointer items-center rounded-md px-1.5 py-0.5 text-xs",
							label
								? "bg-muted text-muted-foreground"
								: "text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 [.haunter-task:hover_&]:opacity-100",
							className,
						)}
					/>
				}
			>
				{chip}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48">
				{members.map((member) => {
					const name = member.user?.name || member.user?.email || "Member";
					return (
						<DropdownMenuItem
							key={member.id}
							onClick={() => onChange(member.userId)}
						>
							<span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-[10px] text-primary leading-none">
								{initials(name)}
							</span>
							<span className="truncate">{name}</span>
						</DropdownMenuItem>
					);
				})}
				{value !== null ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="text-muted-foreground"
							onClick={() => onChange(null)}
						>
							Unassign
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
