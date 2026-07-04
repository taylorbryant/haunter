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
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/client/auth-client";
import { SettingsDialog } from "@/components/settings-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
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
	const router = useRouter();
	const [settingsOpen, setSettingsOpen] = useState(false);

	async function signOut() {
		await authClient.signOut();
		router.push("/");
		router.refresh();
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<Avatar>
								<AvatarFallback>{initials(user.name)}</AvatarFallback>
							</Avatar>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">{user.name}</span>
								<span className="truncate text-xs">{user.email}</span>
							</div>
							<ChevronsUpDownIcon className="ml-auto size-4" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-56 rounded-lg"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={4}
					>
						<DropdownMenuLabel className="p-0 font-normal">
							<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
								<Avatar>
									<AvatarFallback>{initials(user.name)}</AvatarFallback>
								</Avatar>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{user.name}</span>
									<span className="truncate text-xs">{user.email}</span>
								</div>
							</div>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{/* Inline theme switcher: plain buttons (not menu items) so
						    tapping one changes the theme without closing the menu. */}
						<div className="flex items-center justify-between gap-2 px-2 py-1.5">
							<span className="text-muted-foreground text-xs">Theme</span>
							<div className="flex items-center gap-0.5 rounded-md border p-0.5">
								{THEME_OPTIONS.map(({ value, icon: Icon, label }) => (
									<button
										key={value}
										type="button"
										aria-label={label}
										aria-pressed={theme === value}
										onClick={() => setTheme(value)}
										className={cn(
											"flex size-6 items-center justify-center rounded-sm transition-colors",
											theme === value
												? "bg-muted text-foreground"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<Icon className="size-3.5" />
									</button>
								))}
							</div>
						</div>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
							<SettingsIcon />
							Settings
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={signOut}>
							<LogOutIcon />
							Log out
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
