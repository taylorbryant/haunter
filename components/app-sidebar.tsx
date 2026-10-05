"use client";

import { useWorkspacePathname } from "@/client/workspace-navigation";
import { NavUser } from "@/components/nav-user";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { WaitlistDialogTrigger } from "@/features/admin/components/waitlist-dialog";
import type { ChangelogRelease } from "@/features/changelog/releases";
import { NotificationCenter } from "@/features/notifications/components/notification-center";
import { WorkspaceSwitcher } from "@/features/workspaces/components/workspace-switcher";

export function AppSidebar({
	user,
	changelogReleases,
	isAdmin = false,
	className,
}: {
	user: { name: string; email: string; image: string | null };
	changelogReleases: readonly ChangelogRelease[];
	isAdmin?: boolean;
	className?: string;
}) {
	const pathname = useWorkspacePathname();
	const activeWorkspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
	return (
		<WorkspaceSidebar
			className={className}
			workspaceId={activeWorkspaceId}
			workspaceSwitcher={
				<WorkspaceSwitcher activeWorkspaceId={activeWorkspaceId} />
			}
			headerActions={<NotificationCenter />}
			utilityActions={isAdmin ? <WaitlistDialogTrigger /> : null}
			footer={<NavUser user={user} changelogReleases={changelogReleases} />}
		/>
	);
}
