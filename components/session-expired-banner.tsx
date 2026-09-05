"use client";

import { CloudOffIcon, LogInIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import {
	getSessionExpiredSnapshot,
	prepareForSessionRecovery,
	subscribeSessionExpired,
} from "@/client/session-expiration";
import { Button } from "@/components/ui/button";

function signInUrl() {
	const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
	return `/sign-in?next=${encodeURIComponent(next)}`;
}

export function SessionExpiredBanner() {
	const expired = useSyncExternalStore(
		subscribeSessionExpired,
		getSessionExpiredSnapshot,
		() => false,
	);
	const [preparing, setPreparing] = useState(false);
	const [recoveryError, setRecoveryError] = useState(false);

	if (!expired) return null;

	async function continueToSignIn() {
		if (preparing) return;
		setPreparing(true);
		setRecoveryError(false);
		const prepared = await prepareForSessionRecovery();
		if (!prepared) {
			setRecoveryError(true);
			setPreparing(false);
			return;
		}
		window.location.assign(signInUrl());
	}

	return (
		<aside
			role="status"
			aria-live="polite"
			aria-atomic="true"
			className="fixed top-14 right-3 left-3 z-[400] flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur-md sm:left-auto sm:w-96 sm:flex-row sm:items-center"
		>
			<div className="flex min-w-0 flex-1 items-start gap-2.5">
				<CloudOffIcon
					className="mt-0.5 size-4 shrink-0 text-amber-500"
					aria-hidden="true"
				/>
				<div className="min-w-0">
					<p className="font-medium text-sm">Session expired</p>
					<p className="mt-0.5 text-pretty text-muted-foreground text-xs leading-5">
						Unsynced edits are safe in this browser. Sign in to resume syncing.
					</p>
					{recoveryError ? (
						<p className="mt-1 text-pretty text-destructive text-xs leading-5">
							Haunter could not store a recovery copy. Keep this tab open and
							try again before leaving.
						</p>
					) : null}
				</div>
			</div>
			<Button
				type="button"
				className="shrink-0"
				size="sm"
				disabled={preparing}
				onClick={() => void continueToSignIn()}
			>
				<LogInIcon className="size-4 shrink-0" aria-hidden="true" />
				{preparing ? "Saving recovery copy…" : "Sign in again"}
			</Button>
		</aside>
	);
}
