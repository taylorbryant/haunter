"use client";

import {
	MoreHorizontalIcon,
	Share2Icon,
	XIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";
import { useIsMobile } from "@/hooks/use-mobile";

const ShareDrawer = dynamic(
	() =>
		import("@/features/shares/components/share-button").then(
			(mod) => mod.ShareDrawer,
		),
	{ ssr: false },
);

const SharePanel = dynamic(
	() =>
		import("@/features/shares/components/share-button").then(
			(mod) => mod.SharePanel,
		),
	{
		ssr: false,
		loading: () => <p className="text-muted-foreground text-sm">Loading...</p>,
	},
);

/**
 * The header's page-scoped sharing action. Desktop shows it directly; mobile
 * puts it in a "⋯" drawer to keep the narrow header uncluttered. Page history
 * opens from the edited-at indicator beside these actions.
 */
export function HeaderPageActions() {
	const pathname = usePathname();
	const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const canEdit = useCanEditWorkspace();
	const isMobile = useIsMobile();
	const [shareOpen, setShareOpen] = useState(false);

	if (!isMobile) {
		if (!pageId || !canEdit || !synced) return null;

		return (
			<Popover modal open={shareOpen} onOpenChange={setShareOpen}>
					<PopoverTrigger
						render={
							<Button
								variant="ghost"
								size="sm"
								className="text-muted-foreground"
							/>
						}
					>
						<Share2Icon />
						Share
					</PopoverTrigger>
					{shareOpen ? (
						<PopoverContent align="end" className="w-80">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="absolute top-1.5 right-1.5 text-muted-foreground"
								onClick={() => setShareOpen(false)}
							>
								<XIcon />
								<span className="sr-only">Close</span>
							</Button>
							<SharePanel pageId={pageId} active={shareOpen} />
						</PopoverContent>
					) : null}
			</Popover>
		);
	}

	// Both actions are editor-gated, same as their desktop buttons.
	if (!pageId || !canEdit || !synced) return null;

	return (
		<>
			<Drawer showSwipeHandle>
				<DrawerTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							className="text-muted-foreground"
							aria-label="Page actions"
						/>
					}
				>
					<MoreHorizontalIcon />
				</DrawerTrigger>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>Actions</DrawerTitle>
						<DrawerDescription className="sr-only">
							Page actions
						</DrawerDescription>
					</DrawerHeader>
					<div className="flex flex-col p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
						<DrawerClose
							render={
								<Button
									variant="ghost"
									className="h-11 justify-start"
									onClick={() => setShareOpen(true)}
								/>
							}
						>
							<Share2Icon />
							Share
						</DrawerClose>
					</div>
				</DrawerContent>
			</Drawer>
			{shareOpen ? (
				<ShareDrawer
					pageId={pageId}
					open={shareOpen}
					onOpenChange={setShareOpen}
				/>
			) : null}
		</>
	);
}
