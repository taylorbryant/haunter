"use client";

import { ChevronDownIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/client/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canManageMembers } from "@/lib/org-access";

// Roles an admin/owner can assign. Ownership transfer is separate, so owner is
// not offered here.
const ASSIGNABLE_ROLES = ["viewer", "member", "admin"] as const;

const ROLE_LABEL: Record<string, string> = {
	owner: "Owner",
	admin: "Admin",
	member: "Member",
	viewer: "Viewer",
};

function initials(text: string) {
	return text.slice(0, 2).toUpperCase();
}

export function MembersDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const router = useRouter();
	const orgQuery = authClient.useActiveOrganization();
	const activeMemberQuery = authClient.useActiveMember();
	const org = orgQuery.data;
	const myRole = activeMemberQuery.data?.role ?? null;
	const myMemberId = activeMemberQuery.data?.id ?? null;
	const canManage = canManageMembers(myRole);

	const members = org?.members ?? [];
	const invitations = (org?.invitations ?? []).filter(
		(invite) => invite.status === "pending",
	);

	const [email, setEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<string>("member");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function refresh() {
		await Promise.all([orgQuery.refetch?.(), activeMemberQuery.refetch?.()]);
	}

	async function invite() {
		const address = email.trim();
		if (!address || busy) return;
		setBusy(true);
		setError(null);
		const { error: inviteError } = await authClient.organization.inviteMember({
			email: address,
			role: inviteRole as "member",
		});
		setBusy(false);
		if (inviteError) {
			setError(inviteError.message ?? "Could not send the invitation.");
			return;
		}
		setEmail("");
		await refresh();
	}

	async function changeRole(memberId: string, role: string) {
		setBusy(true);
		await authClient.organization.updateMemberRole({
			memberId,
			role: role as "member",
		});
		setBusy(false);
		await refresh();
	}

	async function removeMember(memberIdOrEmail: string) {
		setBusy(true);
		await authClient.organization.removeMember({ memberIdOrEmail });
		setBusy(false);
		await refresh();
	}

	async function cancelInvitation(invitationId: string) {
		setBusy(true);
		await authClient.organization.cancelInvitation({ invitationId });
		setBusy(false);
		await refresh();
	}

	async function leave() {
		if (!org || busy) return;
		setBusy(true);
		await authClient.organization.leave({ organizationId: org.id });
		setBusy(false);
		onOpenChange(false);
		router.push("/");
		router.refresh();
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Members</DialogTitle>
					<DialogDescription>
						{canManage
							? "Invite people and manage their access to this workspace."
							: "People with access to this workspace."}
					</DialogDescription>
				</DialogHeader>

				{canManage ? (
					<form
						className="flex items-end gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							invite();
						}}
					>
						<div className="flex flex-1 flex-col gap-2">
							<Label htmlFor="invite-email">Invite by email</Label>
							<Input
								id="invite-email"
								type="email"
								placeholder="teammate@example.com"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
							/>
						</div>
						<RolePicker value={inviteRole} onChange={setInviteRole} />
						<Button type="submit" disabled={!email.trim() || busy}>
							Invite
						</Button>
					</form>
				) : null}
				{error ? <p className="text-destructive text-sm">{error}</p> : null}

				<div className="flex flex-col gap-1">
					{members.map((member) => {
						const label = member.user?.name || member.user?.email || "Member";
						const isOwner = member.role === "owner";
						const isSelf = member.id === myMemberId;
						const editable = canManage && !isOwner && !isSelf;
						return (
							<div key={member.id} className="flex items-center gap-3 py-1.5">
								<Avatar className="size-8">
									<AvatarFallback>{initials(label)}</AvatarFallback>
								</Avatar>
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-sm">{label}</span>
									{member.user?.email ? (
										<span className="truncate text-muted-foreground text-xs">
											{member.user.email}
										</span>
									) : null}
								</div>
								{editable ? (
									<RolePicker
										value={member.role}
										onChange={(role) => changeRole(member.id, role)}
									/>
								) : (
									<span className="text-muted-foreground text-xs">
										{ROLE_LABEL[member.role] ?? member.role}
									</span>
								)}
								{editable ? (
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="size-8 text-muted-foreground"
										aria-label={`Remove ${label}`}
										onClick={() => removeMember(member.id)}
									>
										<XIcon />
									</Button>
								) : null}
							</div>
						);
					})}
				</div>

				{invitations.length > 0 ? (
					<div className="flex flex-col gap-1">
						<p className="text-muted-foreground text-xs">Pending invitations</p>
						{invitations.map((invite) => (
							<div key={invite.id} className="flex items-center gap-3 py-1.5">
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-sm">{invite.email}</span>
									<span className="text-muted-foreground text-xs">
										Invited as {ROLE_LABEL[invite.role ?? "member"]}
									</span>
								</div>
								{canManage ? (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={busy}
										onClick={() => cancelInvitation(invite.id)}
									>
										Cancel
									</Button>
								) : null}
							</div>
						))}
					</div>
				) : null}

				{myRole && myRole !== "owner" ? (
					<div className="border-t pt-3">
						<Button
							type="button"
							variant="ghost"
							className="text-destructive hover:text-destructive"
							disabled={busy}
							onClick={leave}
						>
							Leave workspace
						</Button>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function RolePicker({
	value,
	onChange,
}: {
	value: string;
	onChange: (role: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button type="button" variant="outline" size="sm" className="gap-1" />
				}
			>
				{ROLE_LABEL[value] ?? value}
				<ChevronDownIcon className="opacity-50" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{ASSIGNABLE_ROLES.map((role) => (
					<DropdownMenuItem key={role} onClick={() => onChange(role)}>
						{ROLE_LABEL[role]}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
