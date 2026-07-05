"use client";

import {
	ChevronsUpDownIcon,
	LogOutIcon,
	MonitorIcon,
	MoonIcon,
	SettingsIcon,
	SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { authClient } from "@/client/auth-client";
import { SettingsDialog } from "@/components/settings-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
	{ value: "system", icon: MonitorIcon, label: "System" },
	{ value: "light", icon: SunIcon, label: "Light" },
	{ value: "dark", icon: MoonIcon, label: "Dark" },
] as const;

function initials(name: string): string {
	return (
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase())
			.join("") || "?"
	);
}

export function NavUser({ user }: { user: { name: string; email: string } }) {
	const { isMobile } = useSidebar();
	const { theme, setTheme } = useTheme();
	const [settingsOpen, setSettingsOpen] = useState(false);

	async function signOut() {
		await authClient.signOut();
		// Hard navigation: forces the server to re-evaluate the now-cleared
		// session and redirect to sign-in, and drops all client state. More
		// reliable than a client-side push after logout (which on mobile could
		// leave you on a stale, still-"logged in"-looking page).
		window.location.href = "/";
	}

	const userIdentity = (
		<>
			<Avatar>
				<AvatarFallback>{initials(user.name)}</AvatarFallback>
			</Avatar>
			<div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
				<span className="truncate font-medium">{user.name}</span>
				<span className="truncate font-normal text-xs">{user.email}</span>
			</div>
		</>
	);

	const trigger = (
		<SidebarMenuButton
			size="lg"
			className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
		>
			{userIdentity}
			<ChevronsUpDownIcon className="ml-auto size-4" />
		</SidebarMenuButton>
	);

	// Inline theme switcher: plain buttons (not menu/close items) so tapping one
	// changes the theme without closing the menu or drawer.
	const themeControl = (
		<div className="flex items-center gap-0.5 rounded-md border p-0.5">
			{THEME_OPTIONS.map(({ value, icon: Icon, label }) => (
				<button
					key={value}
					type="button"
					aria-label={label}
					aria-pressed={theme === value}
					onClick={() => setTheme(value)}
					className={cn(
						"flex size-7 items-center justify-center rounded-sm transition-colors",
						theme === value
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					<Icon className="size-4" />
				</button>
			))}
		</div>
	);

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				{isMobile ? (
					<Drawer showSwipeHandle>
						<DrawerTrigger render={trigger} />
						<DrawerContent>
							<DrawerHeader>
								<DrawerTitle className="flex items-center justify-center font-normal">
									{/* userIdentity's text column is flex-1 (it fills the
									    sidebar button); the shrink-to-content wrapper keeps
									    it centered here like other drawer titles. */}
									<span className="flex max-w-full items-center gap-2">
										{userIdentity}
									</span>
								</DrawerTitle>
								<DrawerDescription className="sr-only">
									Account menu
								</DrawerDescription>
							</DrawerHeader>
							<div className="flex flex-col gap-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
								<div className="flex items-center justify-between gap-2 px-2 py-1">
									<span className="text-muted-foreground text-sm">Theme</span>
									{themeControl}
								</div>
								<DrawerClose
									render={
										<Button
											variant="ghost"
											className="h-11 justify-start"
											onClick={() => setSettingsOpen(true)}
										/>
									}
								>
									<SettingsIcon />
									Settings
								</DrawerClose>
								<DrawerClose
									render={
										<Button
											variant="ghost"
											className="h-11 justify-start"
											onClick={signOut}
										/>
									}
								>
									<LogOutIcon />
									Log out
								</DrawerClose>
							</div>
						</DrawerContent>
					</Drawer>
				) : (
					<DropdownMenu>
						<DropdownMenuTrigger render={trigger} />
						<DropdownMenuContent
							className="w-56 rounded-lg"
							side="right"
							align="end"
							sideOffset={4}
						>
							{/* Base UI requires GroupLabel to live inside a Group. */}
							<DropdownMenuGroup>
								<DropdownMenuLabel className="p-0 font-normal">
									<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
										{userIdentity}
									</div>
								</DropdownMenuLabel>
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
							<div className="flex items-center justify-between gap-2 px-2 py-1.5">
								<span className="text-muted-foreground text-xs">Theme</span>
								{themeControl}
							</div>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => setSettingsOpen(true)}>
								<SettingsIcon />
								Settings
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={signOut}>
								<LogOutIcon />
								Log out
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
