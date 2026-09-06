"use client";

import * as React from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const ResponsiveDialogContext = React.createContext<{ isMobile: boolean }>({
	isMobile: false,
});

/**
 * A centered dialog on desktop that becomes a bottom drawer on mobile.
 * Controlled-only: every current caller owns the open state, so there is no
 * trigger slot.
 */
export function ResponsiveDialog({
	open,
	onOpenChange,
	title,
	description,
	className,
	finalFocus,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: React.ReactNode;
	description: React.ReactNode;
	/** Extra classes for the desktop DialogContent (e.g. sm:max-w-lg). */
	className?: string;
	finalFocus?: React.ComponentProps<typeof DialogContent>["finalFocus"];
	children: React.ReactNode;
}) {
	const isMobile = useIsMobile();

	if (isMobile) {
		return (
			<Drawer showSwipeHandle open={open} onOpenChange={onOpenChange}>
				<DrawerContent finalFocus={finalFocus}>
					<DrawerHeader>
						<DrawerTitle>{title}</DrawerTitle>
						<DrawerDescription>{description}</DrawerDescription>
					</DrawerHeader>
					<ResponsiveDialogContext.Provider value={{ isMobile: true }}>
						<div className="flex flex-col gap-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
							{children}
						</div>
					</ResponsiveDialogContext.Provider>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={className} finalFocus={finalFocus}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{children}
			</DialogContent>
		</Dialog>
	);
}

/**
 * DialogFooter on desktop; a plain full-width button stack inside the drawer
 * body on mobile (DialogFooter's negative margins assume DialogContent).
 */
export function ResponsiveDialogFooter({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	const { isMobile } = React.useContext(ResponsiveDialogContext);

	if (isMobile) {
		return (
			<div className={cn("flex flex-col gap-2", className)}>{children}</div>
		);
	}

	return <DialogFooter className={className}>{children}</DialogFooter>;
}
