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
import { hasAppAccess } from "@/lib/auth";
import { getAppRequestContext } from "@/lib/server-react-query";

export default async function WaitlistPage() {
	const ctx = await getAppRequestContext();
	const session = ctx.auth;
	if (!session) {
		redirect("/sign-in?next=/waitlist");
	}
	if (await hasAppAccess(ctx)) {
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
