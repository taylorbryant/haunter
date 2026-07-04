"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/client/auth-client";

/**
 * The homepage is My Tasks: send the user to their first workspace's task
 * list. With no workspaces yet, point them at the sidebar switcher.
 */
export default function HomePage() {
	const router = useRouter();
	const organizationsQuery = authClient.useListOrganizations();
	const firstWorkspace = organizationsQuery.data?.[0];

	useEffect(() => {
		if (!firstWorkspace) return;
		authClient.organization
			.setActive({ organizationId: firstWorkspace.id })
			.finally(() => {
				router.replace(`/w/${firstWorkspace.id}/tasks`);
			});
	}, [firstWorkspace, router]);

	if (organizationsQuery.isPending || firstWorkspace) {
		return null;
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
