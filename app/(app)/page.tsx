import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth";

/**
 * The homepage is My Tasks: send the user to their workspace's task list in
 * ONE server-side hop. This used to be a client component that fetched the
 * org list, POSTed set-active, and then client-redirected — three serial
 * round trips of blank screen on every cold load (worst on mobile).
 *
 * The membership list validates a stale activeOrganizationId (e.g. after
 * leaving a workspace) instead of bouncing into a workspace the user can no
 * longer access.
 */
export default async function HomePage() {
	const headerList = await headers();
	const session = await auth.api.getSession({ headers: headerList });
	// The (app) layout already redirects signed-out visitors to /sign-in.
	const activeId = session?.session.activeOrganizationId ?? null;

	const organizations = await auth.api.listOrganizations({
		headers: headerList,
	});
	const target =
		organizations.find((org) => org.id === activeId) ?? organizations[0];
	if (target) {
		redirect(`/w/${target.id}/tasks`);
	}

	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 py-24 text-center">
			<p className="font-medium text-sm">Welcome to Haunter</p>
			<p className="text-muted-foreground text-sm">
				Create your first workspace from the switcher in the sidebar.
			</p>
		</div>
	);
}
