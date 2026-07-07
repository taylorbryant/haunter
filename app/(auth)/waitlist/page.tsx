import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { WaitlistSignOutButton } from "@/components/auth/waitlist-sign-out-button";
import { GhostLogo } from "@/components/ghost-logo";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { hasAppAccessSession } from "@/lib/auth";
import { auth } from "@/lib/better-auth";

export default async function WaitlistPage() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session) {
		redirect("/sign-in?next=/waitlist");
	}
	if (hasAppAccessSession(session)) {
		redirect("/");
	}

	return (
		<Card>
			<CardHeader>
				<GhostLogo className="mb-1 size-9" />
				<CardTitle>You're on the waitlist</CardTitle>
				<CardDescription>
					Your account is set up. We'll let you know when Haunter is ready for
					you.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="text-muted-foreground text-sm">
					If you were invited to a workspace, open the invitation link after
					signing in with this email.
				</p>
			</CardContent>
			<CardFooter>
				<WaitlistSignOutButton />
			</CardFooter>
		</Card>
	);
}
