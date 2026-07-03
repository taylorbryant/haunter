"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileTextIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
	Command,
	CommandDialog,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { searchPagesQueryOptions } from "@/features/pages/client/queries";
import type { SearchResult } from "@/features/pages/schemas";

function useDebouncedValue(value: string, delayMs: number) {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);

	return debounced;
}

/** Sidebar "Search" row plus the ⌘K quick-find dialog it opens. */
export function SearchCommand() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const debounced = useDebouncedValue(query.trim(), 200);

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

	const search = useQuery({
		...searchPagesQueryOptions(debounced),
		enabled: open && debounced.length > 0,
		placeholderData: keepPreviousData,
	});

	const items = debounced.length > 0 ? (search.data?.items ?? []) : [];
	const groups = useMemo(() => {
		const byWorkspace = new Map<string, SearchResult[]>();
		for (const item of items) {
			const group = byWorkspace.get(item.workspaceName);
			if (group) {
				group.push(item);
			} else {
				byWorkspace.set(item.workspaceName, [item]);
			}
		}
		return Array.from(byWorkspace.entries());
	}, [items]);

	function close() {
		setOpen(false);
		setQuery("");
	}

	return (
		<>
			<SidebarMenuItem>
				<SidebarMenuButton tooltip="Search" onClick={() => setOpen(true)}>
					<SearchIcon />
					<span>Search</span>
					<span className="ml-auto text-muted-foreground text-xs">⌘K</span>
				</SidebarMenuButton>
			</SidebarMenuItem>
			<CommandDialog
				open={open}
				onOpenChange={(next) => (next ? setOpen(true) : close())}
				title="Search"
				description="Search pages by title or content"
			>
				{/* Results are already filtered server-side. */}
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search pages…"
						value={query}
						onValueChange={setQuery}
					/>
					<CommandList>
						{groups.map(([workspaceName, groupItems]) => (
							<CommandGroup
								key={workspaceName}
								heading={workspaceName || "Workspace"}
							>
								{groupItems.map((item) => (
									<CommandItem
										key={item.id}
										value={item.id}
										onSelect={() => {
											close();
											router.push(`/w/${item.workspaceId}/p/${item.id}`);
										}}
									>
										{item.icon ? (
											<span aria-hidden>{item.icon}</span>
										) : (
											<FileTextIcon className="text-muted-foreground" />
										)}
										<div className="flex min-w-0 flex-col">
											<span className="truncate">
												{item.title || "Untitled"}
											</span>
											{item.snippet ? (
												<span className="truncate text-muted-foreground text-xs">
													{item.snippet}
												</span>
											) : null}
										</div>
									</CommandItem>
								))}
							</CommandGroup>
						))}
						{items.length === 0 ? (
							<div className="py-6 text-center text-muted-foreground text-sm">
								{debounced.length === 0
									? "Search pages in every workspace."
									: search.isFetching
										? "Searching…"
										: "No pages found."}
							</div>
						) : null}
					</CommandList>
				</Command>
			</CommandDialog>
		</>
	);
}
