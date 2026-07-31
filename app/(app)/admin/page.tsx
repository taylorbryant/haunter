import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth";
import { ADMIN_ROLE } from "@/ports/auth";

export default async function AdminPage() {
	const headerList = await headers();
	const session = await auth.api.getSession({ headers: headerList });
	// The (app) layout already handles signed-out and waitlisted visitors; this
	// legacy route is admin-only, so non-admins are sent back to the app.
	if (session?.user.role !== ADMIN_ROLE) {
		redirect("/");
	}

	const activeId = session.session.activeOrganizationId ?? null;
	const organizations = await auth.api.listOrganizations({
		headers: headerList,
	});
	const target =
		organizations.find((organization) => organization.id === activeId) ??
		organizations[0];

	redirect(target ? `/w/${target.id}/home?dialog=waitlist` : "/");
}
