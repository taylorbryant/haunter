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
import { AgentsPanel } from "@/features/agents/components/agents-panel";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
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

export function SettingsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [active, setActive] = useState<SectionId>("profile");
	const section = SECTIONS.find((item) => item.id === active) ?? SECTIONS[0];
	const Panel = section.panel;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="overflow-hidden p-0 md:max-h-[560px] md:max-w-[760px]"
			>
				<DialogTitle className="sr-only">Settings</DialogTitle>
				{/* min-w-0 stops the grid item from growing to the panel's
				    max-content width, which overflowed the dialog on mobile. */}
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
						{/* The section list is a sidebar on desktop; on mobile it's
						    hidden, so surface the sections as a scrollable tab row —
						    sharing a header with the close button so they never
						    overlap. */}
						<div className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background p-2 md:hidden">
							<div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
								{SECTIONS.map((item) => (
									<Button
										key={item.id}
										type="button"
										size="sm"
										variant={item.id === active ? "secondary" : "ghost"}
										className="shrink-0"
										onClick={() => setActive(item.id)}
									>
										<item.icon />
										{item.label}
									</Button>
								))}
							</div>
							<DialogClose asChild>
								<Button variant="ghost" size="icon-sm" className="shrink-0">
									<XIcon />
									<span className="sr-only">Close</span>
								</Button>
							</DialogClose>
						</div>
						<div className="flex flex-col gap-4 p-6">
							<Panel />
						</div>
					</main>
				</SidebarProvider>
				{/* Desktop close (the default corner button is disabled above);
				    absolute to the dialog so it stays put while the panel scrolls. */}
				<DialogClose asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className="absolute top-3 right-3 z-10 hidden md:flex"
					>
						<XIcon />
						<span className="sr-only">Close</span>
					</Button>
				</DialogClose>
			</DialogContent>
		</Dialog>
	);
}
