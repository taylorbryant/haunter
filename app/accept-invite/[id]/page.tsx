"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
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
	const [invite, setInvite] = useState<Invitation | null>(null);
	const [status, setStatus] = useState<Status>("loading");
	const [error, setError] = useState("");

	useEffect(() => {
		if (isPending) return;
		if (!session) {
			setStatus("need-auth");
			return;
		}
		authClient.organization
			.getInvitation({ query: { id } })
			.then(({ data, error: inviteError }) => {
				if (inviteError || !data) {
					setError(
						inviteError?.message ?? "This invitation is no longer valid.",
					);
					setStatus("error");
					return;
				}
				setInvite(data as Invitation);
				setStatus("ready");
			});
	}, [id, session, isPending]);

	async function accept() {
		setStatus("working");
		const { data, error: acceptError } =
			await authClient.organization.acceptInvitation({ invitationId: id });
		if (acceptError) {
			setError(acceptError.message ?? "Could not accept this invitation.");
			setStatus("error");
			return;
		}
		const orgId =
			invite?.organizationId ?? data?.invitation?.organizationId ?? null;
		if (orgId) {
			await authClient.organization.setActive({ organizationId: orgId });
		}
		router.push(orgId ? `/w/${orgId}` : "/");
		router.refresh();
	}

	async function decline() {
		setStatus("working");
		await authClient.organization.rejectInvitation({ invitationId: id });
		router.push("/");
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
							Sign in with the email this invitation was sent to, then open the
							invitation link again.
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
						<Button asChild>
							<Link href="/sign-in">Sign in</Link>
						</Button>
					) : null}
					{status === "error" ? (
						<Button asChild variant="ghost">
							<Link href="/">Go home</Link>
						</Button>
					) : null}
				</CardFooter>
			</Card>
		</main>
	);
}
