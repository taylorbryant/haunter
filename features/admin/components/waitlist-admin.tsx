"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	approveWaitlistUserMutationOptions,
	invalidateWaitlist,
	listWaitlistQueryOptions,
} from "@/features/admin/client/queries";
import type { WaitlistUser } from "@/features/admin/schemas";

function initials(text: string) {
	return text.slice(0, 2).toUpperCase();
}

function formatJoined(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export function WaitlistAdmin() {
	const queryClient = useQueryClient();
	const waitlistQuery = useQuery(listWaitlistQueryOptions());
	const approveMutation = useMutation(approveWaitlistUserMutationOptions());
	// The row currently being approved, so only its button shows a pending state.
	const [approvingId, setApprovingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const users = waitlistQuery.data?.items ?? [];

	function approve(user: WaitlistUser) {
		if (approveMutation.isPending) return;
		setApprovingId(user.id);
		setError(null);
		approveMutation.mutate(
			{ path: { userId: user.id } },
			{
				onSuccess: async () => {
					await invalidateWaitlist(queryClient);
				},
				onError: () => {
					setError(`Could not approve ${user.email}. Please try again.`);
				},
				onSettled: () => {
					setApprovingId(null);
				},
			},
		);
	}

	if (waitlistQuery.isPending) {
		return <p className="text-muted-foreground text-sm">Loading waitlist…</p>;
	}

	if (waitlistQuery.isError) {
		return (
			<p role="alert" className="text-destructive text-sm">
				Could not load the waitlist.
			</p>
		);
	}

	if (users.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No one is waiting for access right now.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			) : null}
			<ul className="flex flex-col divide-y">
				{users.map((user) => {
					const label = user.name || user.email;
					const joined = formatJoined(user.createdAt);
					// Only repeat the email in the subline when the primary label is a
					// name; a nameless user already shows their email as the label.
					const subline = [user.name ? user.email : null, joined && `joined ${joined}`]
						.filter(Boolean)
						.join(" · ");
					const pending = approvingId === user.id;
					return (
						<li key={user.id} className="flex items-center gap-3 py-3">
							<Avatar className="size-8">
								<AvatarFallback>{initials(label)}</AvatarFallback>
							</Avatar>
							<div className="flex min-w-0 flex-1 flex-col">
								<span className="truncate text-sm">{label}</span>
								{subline ? (
									<span className="truncate text-muted-foreground text-xs">
										{subline}
									</span>
								) : null}
							</div>
							<Button
								type="button"
								size="sm"
								disabled={pending}
								onClick={() => approve(user)}
							>
								{pending ? "Approving…" : "Approve"}
							</Button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
