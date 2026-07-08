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

/** Sidebar "Search" row plus the ⌘K palette it opens (pages + commands). */
export function SearchCommand() {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
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
				<SidebarMenuButton tooltip="Search" onClick={() => setOpen(true)}>
					<SearchIcon />
					<span>Search</span>
					<span className="ml-auto text-muted-foreground text-xs">⌘K</span>
				</SidebarMenuButton>
			</SidebarMenuItem>
			{open ? <SearchCommandDialog open={open} onOpenChange={setOpen} /> : null}
		</>
	);
}
