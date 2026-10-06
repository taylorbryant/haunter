"use client";

import { SearchIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

const SearchCommandDialog = dynamic(
	() =>
		import("@/components/search-command-dialog").then(
			(mod) => mod.SearchCommandDialog,
		),
	{ ssr: false },
);

/** Sidebar Search and its palette. Shift provides an alternative to host shortcuts. */
export function SearchCommand({
	preferShiftShortcut = false,
}: {
	preferShiftShortcut?: boolean;
}) {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (
				!event.defaultPrevented &&
				!event.repeat &&
				!event.isComposing &&
				!event.altKey &&
				event.key.toLowerCase() === "k" &&
				(event.metaKey || event.ctrlKey)
			) {
				event.preventDefault();
				setOpen((current) => !current);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<>
			<SidebarMenuItem>
				<SidebarMenuButton
					tooltip={preferShiftShortcut ? "Search (⇧⌘K)" : "Search (⌘K)"}
					aria-keyshortcuts="Meta+K Control+K Meta+Shift+K Control+Shift+K"
					onClick={() => setOpen(true)}
				>
					<SearchIcon />
					<span>Search</span>
					<span className="ml-auto text-muted-foreground text-xs">
						{preferShiftShortcut ? "⇧⌘K" : "⌘K"}
					</span>
				</SidebarMenuButton>
			</SidebarMenuItem>
			{open ? <SearchCommandDialog open={open} onOpenChange={setOpen} /> : null}
		</>
	);
}
