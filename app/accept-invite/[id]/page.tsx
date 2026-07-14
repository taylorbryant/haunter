"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { authClient } from "@/client/auth-client";
import { GhostLogo } from "@/components/ghost-logo";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	acceptWorkspaceInvitation,
	INVITATION_UNAVAILABLE_MESSAGE,
} from "@/features/workspaces/client/accept-workspace-invitation";

type Invitation = {
	organizationId: string;
	organizationName?: string;
	role?: string;
	email?: string;
};

type Status = "loading" | "need-auth" | "ready" | "working" | "error" | "done";

export default function AcceptInvitePage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const router = useRouter();
	const { data: session, isPending } = authClient.useSession();
	const userId = session?.user.id ?? null;
	const organizationsQuery = authClient.useListOrganizations();
	const actionInFlight = useRef(false);
	const loadedInvitationKey = useRef<string | null>(null);
	const [invite, setInvite] = useState<Invitation | null>(null);
	const [status, setStatus] = useState<Status>("loading");
	const [error, setError] = useState("");

	useEffect(() => {
		// Accepting an invitation refreshes the session. Once an action starts,
		// never reload the single-use invitation in response to that refresh.
		if (actionInFlight.current) return;
		if (isPending) return;
		if (!userId) {
			setInvite(null);
			setStatus("need-auth");
			return;
		}
		const invitationKey = `${id}:${userId}`;
		if (loadedInvitationKey.current === invitationKey) return;
		setError("");
		setStatus("loading");
		let cancelled = false;
		authClient.organization
			.getInvitation({ query: { id } })
			.then(({ data, error: inviteError }) => {
				if (cancelled) return;
				loadedInvitationKey.current = invitationKey;
				if (inviteError || !data) {
					setError(
						inviteError?.code === "INVITATION_NOT_FOUND"
							? INVITATION_UNAVAILABLE_MESSAGE
							: (inviteError?.message ?? "This invitation is no longer valid."),
					);
					setStatus("error");
					return;
				}
				setInvite(data as Invitation);
				setStatus("ready");
			})
			.catch((loadError: unknown) => {
				if (cancelled) return;
				loadedInvitationKey.current = invitationKey;
				setError(
					loadError instanceof Error
						? loadError.message
						: "Could not load this invitation.",
				);
				setStatus("error");
			});
		return () => {
			cancelled = true;
		};
	}, [id, userId, isPending]);

	async function enterWorkspace(orgId: string) {
		const { error: activeError } = await authClient.organization.setActive({
			organizationId: orgId,
		});
		if (activeError) {
			throw new Error(
				activeError.message ?? "Could not open the new workspace.",
			);
		}
		// Refresh the shared org-list cache before redirecting so the switcher
		// includes the workspace we just joined (mirror of the leave() fix).
		await organizationsQuery.refetch?.();
		setStatus("done");
		// The invitation is single-use; replacing keeps Back from reopening it.
		router.replace(`/w/${orgId}`);
		router.refresh();
	}

	function showActionError(message: string) {
		actionInFlight.current = false;
		setError(message);
		setStatus("error");
	}

	async function accept() {
		// State updates do not disable the button until the next render. This ref
		// prevents a fast double click from submitting the single-use invite twice.
		if (actionInFlight.current) return;
		actionInFlight.current = true;
		setError("");
		setStatus("working");
		const result = await acceptWorkspaceInvitation(
			{
				invitationId: id,
				knownOrganizationId: invite?.organizationId ?? null,
			},
			{
				acceptInvitation: (invitationId) =>
					authClient.organization.acceptInvitation({ invitationId }),
				listOrganizations: () => authClient.organization.list(),
			},
		);
		if (!result.ok) {
			showActionError(result.error);
			return;
		}
		try {
			await enterWorkspace(result.organizationId);
		} catch (activationError) {
			showActionError(
				activationError instanceof Error
					? activationError.message
					: "Could not open the new workspace.",
			);
		}
	}

	async function decline() {
		if (actionInFlight.current) return;
		actionInFlight.current = true;
		setError("");
		setStatus("working");
		const { error: rejectError } =
			await authClient.organization.rejectInvitation({ invitationId: id });
		if (rejectError) {
			showActionError(
				rejectError.code === "INVITATION_NOT_FOUND"
					? INVITATION_UNAVAILABLE_MESSAGE
					: (rejectError.message ?? "Could not decline this invitation."),
			);
			return;
		}
		router.replace("/");
	}

	return (
		<main className="flex min-h-dvh items-center justify-center p-6">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<GhostLogo className="mb-1 size-9" />
					<CardTitle>Workspace invitation</CardTitle>
					<CardDescription>
						{status === "loading" || status === "working"
							? "One moment…"
							: status === "need-auth"
								? "Sign in to accept this invitation."
								: status === "error"
									? error
									: invite
										? `You've been invited to join ${
												invite.organizationName ?? "a workspace"
											}${invite.role ? ` as a ${invite.role}` : ""}.`
										: ""}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{status === "need-auth" ? (
						<p className="text-muted-foreground text-sm">
							Sign in with the email this invitation was sent to — you'll come
							right back here.
						</p>
					) : null}
				</CardContent>
				<CardFooter className="flex gap-2">
					{status === "ready" ? (
						<>
							<Button onClick={accept}>Accept invitation</Button>
							<Button variant="ghost" onClick={decline}>
								Decline
							</Button>
						</>
					) : null}
					{status === "need-auth" ? (
						// ?next= brings the user straight back to this invitation after
						// the OTP flow instead of dropping them in their own workspace.
						<Button
							render={
								<Link
									href={`/sign-in?next=${encodeURIComponent(`/accept-invite/${id}`)}`}
								/>
							}
							nativeButton={false}
						>
							Sign in
						</Button>
					) : null}
					{status === "error" ? (
						<Button
							variant="ghost"
							render={<Link href="/" />}
							nativeButton={false}
						>
							Go home
						</Button>
					) : null}
				</CardFooter>
			</Card>
		</main>
	);
}
