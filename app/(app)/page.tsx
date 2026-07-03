"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { listWorkspacesQueryOptions } from "@/features/workspaces/client/queries";

/**
 * The homepage is My Tasks: send the user to their first workspace's task
 * list. With no workspaces yet, point them at the sidebar switcher.
 */
export default function HomePage() {
	const router = useRouter();
	const workspacesQuery = useQuery(listWorkspacesQueryOptions());
	const firstWorkspace = workspacesQuery.data?.items[0];

	useEffect(() => {
		if (firstWorkspace) {
			router.replace(`/w/${firstWorkspace.id}/tasks`);
		}
	}, [firstWorkspace, router]);

	if (workspacesQuery.isPending || firstWorkspace) {
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
