"use client";

import { HouseIcon, ListTodoIcon, Trash2Icon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCommand } from "@/components/command-palette/registry";

/**
 * Registers the always-available palette commands — navigation and workspace
 * switching — that have no natural home in another component. Renders nothing.
 * Mounted once inside the CommandRegistryProvider.
 */
export function AppCommands() {
	const router = useRouter();
	const pathname = usePathname();
	const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;

	useCommand(
		workspaceId
			? {
					id: "nav.home",
					title: "Go to Home",
					group: "Go to",
					icon: HouseIcon,
					run: () => router.push(`/w/${workspaceId}/home`),
				}
			: null,
	);

	useCommand(
		workspaceId
			? {
					id: "nav.tasks",
					title: "Go to Tasks",
					group: "Go to",
					icon: ListTodoIcon,
					run: () => router.push(`/w/${workspaceId}/tasks`),
				}
			: null,
	);

	useCommand(
		workspaceId
			? {
					id: "nav.trash",
					title: "Go to Trash",
					group: "Go to",
					icon: Trash2Icon,
					run: () => router.push(`/w/${workspaceId}/trash`),
				}
			: null,
	);

	return null;
}
