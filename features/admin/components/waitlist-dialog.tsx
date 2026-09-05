"use client";

import { ShieldCheckIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { useDraftSafeRouter as useRouter } from "@/client/use-draft-safe-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useCommand } from "@/components/command-palette/registry";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import {
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";

const WaitlistAdmin = dynamic(
	() =>
		import("@/features/admin/components/waitlist-admin").then(
			(module) => module.WaitlistAdmin,
		),
	{ ssr: false },
);

const WAITLIST_DIALOG_PARAM = "waitlist";

const WaitlistDialogContext = createContext<(() => void) | null>(null);

export function WaitlistDialogProvider({
	enabled,
	children,
}: {
	enabled: boolean;
	children: ReactNode;
}) {
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const { isMobile, setOpenMobile } = useSidebar();
	const requestedFromUrl = searchParams.get("dialog") === WAITLIST_DIALOG_PARAM;
	const [open, setOpen] = useState(enabled && requestedFromUrl);

	useEffect(() => {
		if (enabled && requestedFromUrl) setOpen(true);
	}, [enabled, requestedFromUrl]);

	const openDialog = useCallback(() => {
		if (!enabled) return;
		if (isMobile) setOpenMobile(false);
		setOpen(true);
	}, [enabled, isMobile, setOpenMobile]);

	function changeOpen(nextOpen: boolean) {
		setOpen(nextOpen);
		if (nextOpen || !requestedFromUrl) return;

		const nextParams = new URLSearchParams(searchParams.toString());
		nextParams.delete("dialog");
		const query = nextParams.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false,
		});
	}

	useCommand(
		enabled && {
			id: "admin.waitlist",
			title: "Open waitlist",
			group: "Go to",
			keywords: "admin approve access",
			icon: ShieldCheckIcon,
			run: openDialog,
		},
	);

	const contextValue = useMemo(() => openDialog, [openDialog]);

	return (
		<WaitlistDialogContext.Provider value={contextValue}>
			{children}
			<ResponsiveDialog
				open={enabled && open}
				onOpenChange={changeOpen}
				title="Waitlist"
				description="Approve people to let them into Haunter. Each person gets an email letting them know they can sign in."
				className="max-h-[min(36rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl"
			>
				<div className="min-h-0 overflow-y-auto overscroll-contain">
					{open ? <WaitlistAdmin /> : null}
				</div>
			</ResponsiveDialog>
		</WaitlistDialogContext.Provider>
	);
}

export function WaitlistDialogTrigger() {
	const openDialog = useContext(WaitlistDialogContext);
	if (!openDialog) {
		throw new Error(
			"WaitlistDialogTrigger must be used within WaitlistDialogProvider",
		);
	}

	return (
		<SidebarMenuItem>
			<SidebarMenuButton tooltip="Waitlist" onClick={openDialog}>
				<ShieldCheckIcon />
				<span>Waitlist</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
