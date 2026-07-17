"use client";

import { CircleUserRoundIcon } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/client/auth-client";
import { useCurrentUser } from "@/components/app-session-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function initials(text: string) {
	const parts = text.trim().split(/\s+/).filter(Boolean);
	if (parts.length >= 2) {
		return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
	}
	return (parts[0] ?? "").slice(0, 2).toUpperCase();
}

function AssigneeChip({
	label,
	avatarLabel,
	image,
}: {
	label: string | null;
	avatarLabel?: string | null;
	image?: string | null;
}) {
	return label ? (
		<span className="flex items-center gap-1">
			<Avatar className="size-4 rounded-full bg-primary/15 text-[9px] text-primary">
				<AvatarImage src={image ?? undefined} alt="" />
				<AvatarFallback className="bg-transparent font-medium text-[8px] text-inherit leading-none">
					{initials(avatarLabel || label)}
				</AvatarFallback>
			</Avatar>
			<span className="max-w-24 truncate">{label}</span>
		</span>
	) : (
		<span className="flex items-center gap-1">
			<CircleUserRoundIcon className="size-3" />
			Assign
		</span>
	);
}

function ResolvedAssigneeChip({ value }: { value: string | null }) {
	const currentUser = useCurrentUser();
	const orgQuery = authClient.useActiveOrganization();
	const members = orgQuery.data?.members ?? [];
	const current = members.find((member) => member.userId === value) ?? null;
	const label = current
		? current.user?.name || current.user?.email || "Member"
		: value
			? "Assigned"
			: null;
	const currentUserLabel =
		value === currentUser?.id ? currentUser.name || currentUser.email : null;

	return (
		<AssigneeChip
			label={label}
			avatarLabel={currentUserLabel}
			image={current?.user?.image ?? null}
		/>
	);
}

function AssigneePickerContent({
	value,
	onChange,
	onClose,
}: {
	value: string | null;
	onChange: (next: string | null) => void;
	onClose: () => void;
}) {
	const orgQuery = authClient.useActiveOrganization();
	const members = orgQuery.data?.members ?? [];

	return (
		<DropdownMenuContent align="end" className="w-48">
			{orgQuery.error ? (
				<DropdownMenuItem disabled className="text-destructive">
					Members could not be loaded
				</DropdownMenuItem>
			) : null}
			{members.map((member) => {
				const name = member.user?.name || member.user?.email || "Member";
				return (
					<DropdownMenuItem
						key={member.id}
						onClick={() => {
							onChange(member.userId);
							onClose();
						}}
					>
						<Avatar className="size-5 rounded-full bg-primary/15 text-[10px] text-primary">
							<AvatarImage src={member.user?.image ?? undefined} alt="" />
							<AvatarFallback className="bg-transparent font-medium text-[9px] text-inherit leading-none">
								{initials(name)}
							</AvatarFallback>
						</Avatar>
						<span className="truncate">{name}</span>
					</DropdownMenuItem>
				);
			})}
			{value !== null ? (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						className="text-muted-foreground"
						onClick={() => {
							onChange(null);
							onClose();
						}}
					>
						Unassign
					</DropdownMenuItem>
				</>
			) : null}
		</DropdownMenuContent>
	);
}

/**
 * Compact assignee chip + member dropdown. `value` is a user id or null.
 * Renders a static chip when `disabled` (viewers) and an invisible-until-
 * hover "assign" affordance when unassigned, mirroring the due-date chip.
 */
export function AssigneePicker({
	value,
	label,
	onChange,
	disabled = false,
	className,
}: {
	value: string | null;
	label?: string | null;
	onChange: (next: string | null) => void;
	disabled?: boolean;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const currentUser = useCurrentUser();
	const currentUserLabel =
		value === currentUser?.id ? currentUser.name || currentUser.email : null;
	const chip =
		label !== undefined ? (
			<AssigneeChip label={label} avatarLabel={currentUserLabel} />
		) : (
			<ResolvedAssigneeChip value={value} />
		);
	const ariaLabel =
		currentUserLabel ?? label ?? (value ? "Assigned" : "Assign");

	if (disabled) {
		// Viewers: show who owns it, nothing clickable; hide when unassigned.
		return value !== null ? (
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
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-label={
							ariaLabel === "Assign" ? "Assign" : `Assigned to ${ariaLabel}`
						}
						className={cn(
							"flex shrink-0 cursor-pointer items-center rounded-md px-1.5 py-0.5 text-xs",
							value !== null
								? "bg-muted text-muted-foreground"
								: // Touch devices have no hover to reveal the affordance, so
									// keep it visible there (pointer-coarse).
									"text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100 [.haunter-task:hover_&]:opacity-100",
							className,
						)}
					/>
				}
			>
				{chip}
			</DropdownMenuTrigger>
			{open ? (
				<AssigneePickerContent
					value={value}
					onChange={onChange}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</DropdownMenu>
	);
}
