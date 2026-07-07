"use client";

import { authClient } from "@/client/auth-client";
import { Button } from "@/components/ui/button";

export function WaitlistSignOutButton() {
	async function signOut() {
		await authClient.signOut();
		window.location.href = "/sign-in";
	}

	return (
		<Button type="button" variant="outline" onClick={signOut}>
			Use a different email
		</Button>
	);
}
