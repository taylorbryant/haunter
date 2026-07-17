"use client";

import { useState } from "react";
import { authClient } from "@/client/auth-client";
import { authErrorMessage } from "@/client/error-feedback";
import { Button } from "@/components/ui/button";

export function WaitlistSignOutButton() {
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function signOut() {
		setError(null);
		setPending(true);
		try {
			const result = await authClient.signOut();
			if (result.error) throw result.error;
			window.location.href = "/sign-in";
		} catch (signOutError) {
			setError(authErrorMessage(signOutError, "You could not be signed out."));
			setPending(false);
		}
	}

	return (
		<div className="flex flex-col items-center gap-2">
			<Button
				type="button"
				variant="outline"
				disabled={pending}
				onClick={signOut}
			>
				{pending ? "Signing out…" : "Use a different email"}
			</Button>
			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			) : null}
		</div>
	);
}
