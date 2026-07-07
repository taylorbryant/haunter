"use client";

import {
	BotIcon,
	PaletteIcon,
	Trash2Icon,
	UserIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import {
	AppearancePanel,
	DeleteAccountPanel,
	ProfilePanel,
} from "@/components/settings/panels";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@/components/ui/sidebar";
import { AgentsPanel } from "@/features/agents/components/agents-panel";
import { useIsMobile } from "@/hooks/use-mobile";

const SECTIONS = [
	{ id: "profile", label: "Profile", icon: UserIcon, panel: ProfilePanel },
	{
		id: "appearance",
		label: "Appearance",
		icon: PaletteIcon,
		panel: AppearancePanel,
	},
	{
		id: "agents",
		label: "Agents",
		icon: BotIcon,
		panel: AgentsPanel,
	},
	{
		id: "delete",
		label: "Delete account",
		icon: Trash2Icon,
		panel: DeleteAccountPanel,
	},
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function MobileSectionTabs({
	active,
	onActiveChange,
}: {
	active: SectionId;
	onActiveChange: (section: SectionId) => void;
}) {
	return (
		<div
			className="flex min-w-0 gap-1 overflow-x-auto border-b bg-popover p-2"
			role="tablist"
			aria-label="Settings sections"
		>
			{SECTIONS.map((item) => (
				<Button
					key={item.id}
					type="button"
					role="tab"
					aria-selected={item.id === active}
					size="sm"
					variant={item.id === active ? "secondary" : "ghost"}
					className="h-11 shrink-0 px-3"
					onClick={() => onActiveChange(item.id)}
				>
					<item.icon />
					{item.label}
				</Button>
			))}
		</div>
	);
}

export function SettingsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const isMobile = useIsMobile();
	const [active, setActive] = useState<SectionId>("profile");
	const section = SECTIONS.find((item) => item.id === active) ?? SECTIONS[0];
	const Panel = section.panel;

	if (isMobile) {
		return (
			<Drawer showSwipeHandle open={open} onOpenChange={onOpenChange}>
				<DrawerContent className="h-[85dvh]">
					<DrawerHeader className="px-4 pb-3">
						<DrawerTitle>Settings</DrawerTitle>
						<DrawerDescription className="sr-only">
							Account settings
						</DrawerDescription>
					</DrawerHeader>
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-popover">
						<MobileSectionTabs active={active} onActiveChange={setActive} />
						<div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
							<Panel />
						</div>
					</div>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="overflow-hidden p-0 md:max-h-[560px] md:max-w-[760px]"
			>
				<DialogTitle className="sr-only">Settings</DialogTitle>
				{/* min-w-0 stops the grid item from growing to the panel's
				    max-content width, which can overflow the dialog. */}
				<SidebarProvider className="min-h-0 min-w-0 items-start">
					<Sidebar collapsible="none" className="hidden w-48 md:flex">
						<SidebarContent>
							<SidebarGroup>
								<SidebarGroupLabel>Account</SidebarGroupLabel>
								<SidebarGroupContent>
									<SidebarMenu>
										{SECTIONS.map((item) => (
											<SidebarMenuItem key={item.id}>
												<SidebarMenuButton
													isActive={item.id === active}
													onClick={() => setActive(item.id)}
												>
													<item.icon />
													<span>{item.label}</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
										))}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						</SidebarContent>
					</Sidebar>
					<main className="flex h-[560px] min-w-0 flex-1 flex-col overflow-y-auto bg-background">
						<div className="flex flex-col gap-4 p-6">
							<Panel />
						</div>
					</main>
				</SidebarProvider>
				{/* Desktop close (the default corner button is disabled above);
				    absolute to the dialog so it stays put while the panel scrolls. */}
				<DialogClose
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							className="absolute top-3 right-3 z-10 hidden md:flex"
						/>
					}
				>
					<XIcon />
					<span className="sr-only">Close</span>
				</DialogClose>
			</DialogContent>
		</Dialog>
	);
}
