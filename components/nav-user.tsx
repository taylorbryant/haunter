"use client";

import { useQuery } from "@tanstack/react-query";
import {
	ChevronsUpDownIcon,
	LogOutIcon,
	MonitorIcon,
	MoonIcon,
	SettingsIcon,
	SparklesIcon,
	SunIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { rq } from "@/client";
import { draftRegistry } from "@/client/draft-registry";
import { authClient } from "@/client/auth-client";
import { authErrorMessage, reportUserError } from "@/client/error-feedback";
import { useCommand } from "@/components/command-palette/registry";
import { useThemePreferences } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { getChangelogStatus } from "@/features/changelog/contracts";
import type { ChangelogRelease } from "@/features/changelog/releases";
import { useAfterFirstPaint } from "@/hooks/use-after-first-paint";
import { isThemeMode, type ThemeMode } from "@/lib/themes";
import { cn } from "@/lib/utils";

// Both dialogs are rarely opened and carry their own panels, forms and
// clients. Load them on first open instead of with every authenticated route.
const SettingsDialog = dynamic(
	() =>
		import("@/components/settings-dialog").then(
			(module) => module.SettingsDialog,
		),
	{ ssr: false },
);
const ChangelogDialog = dynamic(
	() =>
		import("@/features/changelog/components/changelog-dialog").then(
			(module) => module.ChangelogDialog,
		),
	{ ssr: false },
);

const THEME_MODES = [
	{ id: "system", label: "System", icon: MonitorIcon },
	{ id: "light", label: "Light", icon: SunIcon },
	{ id: "dark", label: "Dark", icon: MoonIcon },
] as const satisfies ReadonlyArray<{
	id: ThemeMode;
	label: string;
	icon: typeof MonitorIcon;
}>;

function ThemeModePicker() {
	const { mode, setMode } = useThemePreferences();

	return (
		<div className="flex items-center justify-between gap-3 px-2 py-1.5">
			<span className="text-muted-foreground text-sm">Theme</span>
			<DropdownMenuRadioGroup
				value={mode}
				onValueChange={(value) => {
					if (isThemeMode(value)) setMode(value);
				}}
				aria-label="Theme mode"
				className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
			>
				{THEME_MODES.map((option) => (
					<DropdownMenuRadioItem
						key={option.id}
						value={option.id}
						closeOnClick={false}
						title={option.label}
						aria-label={option.label}
						className={cn(
							"size-7 justify-center p-0 text-muted-foreground transition-colors [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden",
							mode === option.id && "bg-background text-foreground shadow-xs",
						)}
					>
						<option.icon className="size-4" />
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
		</div>
	);
}

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

export function NavUser({
	user,
	changelogReleases,
}: {
	user: { name: string; email: string; image: string | null };
	changelogReleases: readonly ChangelogRelease[];
}) {
	const { isMobile } = useSidebar();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [changelogOpen, setChangelogOpen] = useState(false);
	// Mount each dialog on its first open and keep it mounted afterwards so the
	// close transition still runs.
	const [settingsMounted, setSettingsMounted] = useState(false);
	const [changelogMounted, setChangelogMounted] = useState(false);
	const openSettings = () => {
		setSettingsMounted(true);
		setSettingsOpen(true);
	};
	const openChangelog = () => {
		setChangelogMounted(true);
		setChangelogOpen(true);
	};
	const afterFirstPaint = useAfterFirstPaint();
	const changelogStatus = useQuery({
		...rq(getChangelogStatus).queryOptions(),
		enabled: afterFirstPaint,
		meta: { errorMode: "silent" },
	});
	const hasUnreadChangelog = changelogStatus.data?.hasUnread === true;

	useCommand({
		id: "nav.changelog",
		opensDialog: true,
		title: "Open changelog",
		group: "Go to",
		keywords: "whats new updates releases",
		icon: SparklesIcon,
		run: () => openChangelog(),
	});

	useCommand({
		id: "settings.open",
		opensDialog: true,
		title: "Open settings",
		group: "General",
		keywords: "profile appearance account preferences",
		icon: SettingsIcon,
		run: () => openSettings(),
	});

	async function signOut() {
		try {
			if (!(await draftRegistry.flushLocal())) {
				reportUserError(
					"Download your draft before signing out. Your latest changes could not be saved in this browser.",
				);
				return;
			}
			const result = await authClient.signOut();
			if (result.error) throw result.error;
			// Hard navigation: forces the server to re-evaluate the now-cleared
			// session and redirect to sign-in, and drops all client state.
			window.location.href = "/";
		} catch (error) {
			reportUserError(authErrorMessage(error, "You could not be signed out."));
		}
	}

	const userIdentity = (
		<>
			<Avatar>
				<AvatarImage src={user.image ?? undefined} alt="" />
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

	const changelogIndicator = hasUnreadChangelog ? (
		<>
			<span
				className="ml-auto size-2 shrink-0 rounded-full bg-primary"
				aria-hidden
			/>
			<span className="sr-only">New updates</span>
		</>
	) : null;

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
								<DrawerClose
									render={
										<Button
											variant="ghost"
											className="h-11 justify-start"
											onClick={() => openChangelog()}
										/>
									}
								>
									<SparklesIcon />
									What’s new
									{changelogIndicator}
								</DrawerClose>
								<DrawerClose
									render={
										<Button
											variant="ghost"
											className="h-11 justify-start"
											onClick={() => openSettings()}
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
							<ThemeModePicker />
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => openChangelog()}>
								<SparklesIcon />
								What’s new
								{changelogIndicator}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => openSettings()}>
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
				{changelogMounted ? (
					<ChangelogDialog
						open={changelogOpen}
						onOpenChange={setChangelogOpen}
						releases={changelogReleases}
					/>
				) : null}
				{settingsMounted ? (
					<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
				) : null}
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
