import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { WaitlistAdmin } from "@/features/admin/components/waitlist-admin";
import { auth } from "@/lib/better-auth";
import { ADMIN_ROLE } from "@/ports/auth";

export default async function AdminPage() {
	const session = await auth.api.getSession({ headers: await headers() });
	// The (app) layout already handles signed-out and waitlisted visitors; this
	// page is admin-only, so non-admins are sent back to the app.
	if (session?.user.role !== ADMIN_ROLE) {
		redirect("/");
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
			<div className="flex flex-col gap-1">
				<h1 className="font-heading font-semibold text-xl">Waitlist</h1>
				<p className="text-muted-foreground text-sm">
					Approve people to let them into Haunter. Each person gets an email
					letting them know they can sign in.
				</p>
			</div>
			<WaitlistAdmin />
		</div>
	);
}
