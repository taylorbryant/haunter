"use client";

import { KeyRoundIcon, PaletteIcon, Trash2Icon, UserIcon } from "lucide-react";
import { useState } from "react";
import {
	AppearancePanel,
	DeleteAccountPanel,
	PasswordPanel,
	ProfilePanel,
} from "@/components/settings/panels";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
		id: "password",
		label: "Password",
		icon: KeyRoundIcon,
		panel: PasswordPanel,
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
			<DialogContent className="overflow-hidden p-0 md:max-h-[560px] md:max-w-[760px]">
				<DialogTitle className="sr-only">Settings</DialogTitle>
				<SidebarProvider className="min-h-0 items-start">
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
					<main className="flex h-[560px] min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-background p-6">
						<Panel />
					</main>
				</SidebarProvider>
			</DialogContent>
		</Dialog>
	);
}
