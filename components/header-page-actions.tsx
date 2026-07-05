"use client";

import { HistoryIcon, MoreHorizontalIcon, Share2Icon } from "lucide-react";
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
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	PageHistoryButton,
	PageHistoryDialog,
} from "@/features/pages/components/page-history-dialog";
import {
	ShareButton,
	ShareDrawer,
} from "@/features/shares/components/share-button";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * The header's page-scoped actions. Desktop shows the History and Share
 * buttons side by side; mobile collapses them into one "⋯" menu (a bottom
 * drawer, Notion-style) to keep the narrow header uncluttered.
 */
export function HeaderPageActions() {
	const pathname = usePathname();
	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;
	const canEdit = useCanEditWorkspace();
	const isMobile = useIsMobile();
	const [historyOpen, setHistoryOpen] = useState(false);
	const [shareOpen, setShareOpen] = useState(false);

	if (!isMobile) {
		return (
			<>
				<PageHistoryButton />
				<ShareButton />
			</>
		);
	}

	// Both actions are editor-gated, same as their desktop buttons.
	if (!pageId || !canEdit) return null;

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
									onClick={() => setHistoryOpen(true)}
								/>
							}
						>
							<HistoryIcon />
							History
						</DrawerClose>
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
			{historyOpen ? (
				<PageHistoryDialog pageId={pageId} onOpenChange={setHistoryOpen} />
			) : null}
			<ShareDrawer
				pageId={pageId}
				open={shareOpen}
				onOpenChange={setShareOpen}
			/>
		</>
	);
}
