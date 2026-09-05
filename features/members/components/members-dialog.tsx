"use client";

import { ChevronDownIcon, XIcon } from "lucide-react";
import { useDraftSafeRouter as useRouter } from "@/client/use-draft-safe-router";
import { useState } from "react";
import { authClient } from "@/client/auth-client";
import { authErrorMessage } from "@/client/error-feedback";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canManageMembers } from "@/lib/org-roles";

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
	const organizationsQuery = authClient.useListOrganizations();
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
	const [memberToRemove, setMemberToRemove] = useState<{
		id: string;
		label: string;
	} | null>(null);
	const [leaveOpen, setLeaveOpen] = useState(false);

	async function refresh() {
		await Promise.all([orgQuery.refetch?.(), activeMemberQuery.refetch?.()]);
	}

	async function invite() {
		const address = email.trim();
		if (!address || busy) return;
		setBusy(true);
		setError(null);
		try {
			const result = await authClient.organization.inviteMember({
				email: address,
				role: inviteRole as "member",
			});
			if (result.error) throw result.error;
			setEmail("");
			await refresh();
		} catch (inviteError) {
			setError(authErrorMessage(inviteError, "Could not send the invitation."));
		} finally {
			setBusy(false);
		}
	}

	async function changeRole(memberId: string, role: string) {
		setBusy(true);
		setError(null);
		try {
			const result = await authClient.organization.updateMemberRole({
				memberId,
				role: role as "member",
			});
			if (result.error) throw result.error;
			await refresh();
		} catch (roleError) {
			setError(
				authErrorMessage(roleError, "Could not update the member role."),
			);
		} finally {
			setBusy(false);
		}
	}

	async function removeMember(memberIdOrEmail: string) {
		setBusy(true);
		setError(null);
		try {
			const result = await authClient.organization.removeMember({
				memberIdOrEmail,
			});
			if (result.error) throw result.error;
			await refresh();
			setMemberToRemove(null);
		} catch (removeError) {
			setError(authErrorMessage(removeError, "Could not remove the member."));
		} finally {
			setBusy(false);
		}
	}

	async function cancelInvitation(invitationId: string) {
		setBusy(true);
		setError(null);
		try {
			const result = await authClient.organization.cancelInvitation({
				invitationId,
			});
			if (result.error) throw result.error;
			await refresh();
		} catch (cancelError) {
			setError(
				authErrorMessage(cancelError, "Could not cancel the invitation."),
			);
		} finally {
			setBusy(false);
		}
	}

	function confirmRemoveMember() {
		if (!memberToRemove || busy) return;
		removeMember(memberToRemove.id);
	}

	async function leave() {
		if (!org || busy) return;
		setBusy(true);
		setError(null);
		try {
			const result = await authClient.organization.leave({
				organizationId: org.id,
			});
			if (result.error) throw result.error;
			// Refresh the shared org-list cache before redirecting: the switcher
			// must drop this workspace, and the home page picks the first list
			// entry — a stale list would bounce us back into the one we just left.
			await organizationsQuery.refetch?.();
			setLeaveOpen(false);
			onOpenChange(false);
			router.push("/");
			router.refresh();
		} catch (leaveError) {
			setError(authErrorMessage(leaveError, "Could not leave the workspace."));
		} finally {
			setBusy(false);
		}
	}

	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Members"
			description={
				canManage
					? "Invite people and manage their access to this workspace."
					: "People with access to this workspace."
			}
			className="sm:max-w-lg"
		>
			{orgQuery.error ? (
				<div
					role="alert"
					className="flex items-center gap-2 text-destructive text-sm"
				>
					<span className="flex-1">
						The workspace members could not be loaded.
					</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void orgQuery.refetch?.()}
					>
						Try again
					</Button>
				</div>
			) : null}
			{canManage ? (
				<form
					// Stacks on mobile so the email field keeps a usable width.
					className="flex flex-col gap-2 sm:flex-row sm:items-end"
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
					<div className="flex items-center justify-end gap-2">
						<RolePicker value={inviteRole} onChange={setInviteRole} />
						<Button type="submit" disabled={!email.trim() || busy}>
							Invite
						</Button>
					</div>
				</form>
			) : null}
			{error && !memberToRemove && !leaveOpen ? (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			) : null}

			<div className="flex flex-col gap-1">
				{members.map((member) => {
					const label = member.user?.name || member.user?.email || "Member";
					const isOwner = member.role === "owner";
					const isSelf = member.id === myMemberId;
					const editable = canManage && !isOwner && !isSelf;
					return (
						<div key={member.id} className="flex items-center gap-3 py-1.5">
							<Avatar className="size-8">
								<AvatarImage src={member.user?.image ?? undefined} alt="" />
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
									onClick={() => {
										setError(null);
										setMemberToRemove({ id: member.id, label });
									}}
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
						onClick={() => {
							setError(null);
							setLeaveOpen(true);
						}}
					>
						Leave workspace
					</Button>
				</div>
			) : null}
			<DestructiveConfirmationDialog
				open={memberToRemove !== null}
				onOpenChange={(nextOpen) => {
					if (!nextOpen) {
						setMemberToRemove(null);
						setError(null);
					}
				}}
				title="Remove member?"
				description={
					<span className="break-words">
						Remove {memberToRemove?.label ?? "this member"} from this workspace?
						They will lose access immediately.
					</span>
				}
				actionLabel="Remove member"
				pendingLabel="Removing…"
				pending={busy}
				error={error}
				onConfirm={confirmRemoveMember}
			/>
			<DestructiveConfirmationDialog
				open={leaveOpen}
				onOpenChange={(nextOpen) => {
					setLeaveOpen(nextOpen);
					if (!nextOpen) setError(null);
				}}
				title="Leave workspace?"
				description={
					<span className="break-words">
						You will lose access to {org?.name ?? "this workspace"} unless
						someone invites you again.
					</span>
				}
				actionLabel="Leave workspace"
				pendingLabel="Leaving…"
				pending={busy}
				error={error}
				onConfirm={leave}
			/>
		</ResponsiveDialog>
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
