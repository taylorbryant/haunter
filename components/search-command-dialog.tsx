"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	CornerDownLeftIcon,
	FileTextIcon,
	ShapesIcon,
	CheckSquareIcon,
} from "lucide-react";
import { useWorkspacePathname as usePathname } from "@/client/workspace-navigation";
import { useDraftSafeRouter as useRouter } from "@/client/use-draft-safe-router";
import { useEffect, useRef, useState } from "react";
import { useFilteredCommandGroups } from "@/components/command-palette/registry";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandDialog,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@/components/ui/command";
import { getPageNavigationQueryOptions } from "@/features/pages/client/queries";
import { formatViewedAt } from "@/features/pages/lib/format-viewed-at";

import { searchWorkspaceQueryOptions } from "@/features/search/client/queries";
import type { SearchKind } from "@/features/search/schemas";

function useDebouncedValue(value: string, delayMs: number) {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);

	return debounced;
}

const COMMAND_PREFIX = ">";

export function SearchCommandDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<SearchKind>("all");

	const isCommandMode = query.startsWith(COMMAND_PREFIX);
	const commandQuery = isCommandMode ? query.slice(COMMAND_PREFIX.length) : "";
	const debounced = useDebouncedValue(query.trim(), 200);

	const search = useInfiniteQuery({
		...searchWorkspaceQueryOptions(workspaceId ?? "", debounced, kind),
		enabled:
			open && Boolean(workspaceId) && !isCommandMode && debounced.length >= 2,
	});
	const navigation = useQuery({
		...getPageNavigationQueryOptions(workspaceId ?? ""),
		enabled: open && Boolean(workspaceId) && debounced.length === 0,
	});

	const results =
		!isCommandMode && query.trim() === debounced && debounced.length >= 2
			? [
					...new Map(
						(search.data?.pages.flatMap((page) => page.items) ?? []).map(
							(item) => [`${item.kind}:${item.id}`, item],
						),
					).values(),
				]
			: [];
	const commandGroups = useFilteredCommandGroups(commandQuery);

	function close() {
		setQuery("");
		onOpenChange(false);
	}

	function runCommand(run: () => void) {
		close();
		run();
	}

	return (
		<CommandDialog
			open={open}
			onOpenChange={(next) => (next ? onOpenChange(true) : close())}
			title={isCommandMode ? "Commands" : "Search"}
			description={
				isCommandMode
					? "Run a command"
					: "Search pages, tasks, and canvases, or type > for commands"
			}
			initialFocus={inputRef}
		>
			<Command shouldFilter={false}>
				<CommandInput
					ref={inputRef}
					maxLength={200}
					placeholder={
						isCommandMode
							? "Type a command..."
							: "Search workspace, or > for commands..."
					}
					value={query}
					onValueChange={setQuery}
				/>
				{!isCommandMode && (
					<fieldset
						className="flex gap-1 border-b px-3 py-2"
						aria-label="Search types"
					>
						{(["all", "page", "task", "canvas"] as const).map((value) => (
							<Button
								key={value}
								type="button"
								size="sm"
								variant={kind === value ? "secondary" : "ghost"}
								aria-pressed={kind === value}
								onClick={() => setKind(value)}
							>
								{
									{
										all: "All",
										page: "Pages",
										task: "Tasks",
										canvas: "Canvases",
									}[value]
								}
							</Button>
						))}
					</fieldset>
				)}
				<CommandList>
					{isCommandMode ? (
						commandGroups.length > 0 ? (
							commandGroups.map(({ group, commands }) => (
								<CommandGroup key={group} heading={group}>
									{commands.map((command) => (
										<CommandItem
											key={command.id}
											value={command.id}
											onSelect={() => runCommand(command.run)}
										>
											{command.icon ? (
												<command.icon className="text-muted-foreground" />
											) : (
												<CornerDownLeftIcon className="text-muted-foreground" />
											)}
											<span className="truncate">{command.title}</span>
											{command.shortcut ? (
												<CommandShortcut>{command.shortcut}</CommandShortcut>
											) : null}
										</CommandItem>
									))}
								</CommandGroup>
							))
						) : (
							<div className="py-6 text-center text-muted-foreground text-sm">
								No matching commands.
							</div>
						)
					) : debounced.length === 0 && navigation.isError ? (
						<div className="flex flex-col items-center gap-2 py-6 text-center text-destructive text-sm">
							<p role="alert">Recent pages could not be loaded.</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void navigation.refetch()}
							>
								Try again
							</Button>
						</div>
					) : debounced.length === 0 &&
						(navigation.data?.recents.length ?? 0) > 0 ? (
						<CommandGroup heading="Recent">
							{navigation.data?.recents.map((item) => (
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
									<div className="flex min-w-0 flex-1 items-center gap-3">
										<span className="min-w-0 flex-1 truncate">
											{item.title || "Untitled"}
										</span>
										{item.lastViewedAt ? (
											<span className="shrink-0 text-muted-foreground text-xs">
												{formatViewedAt(item.lastViewedAt)}
											</span>
										) : null}
									</div>
								</CommandItem>
							))}
						</CommandGroup>
					) : search.isError &&
						results.length === 0 &&
						debounced.length >= 2 &&
						query.trim() === debounced ? (
						<div className="flex flex-col items-center gap-2 py-6 text-center text-destructive text-sm">
							<p role="alert">Search could not be completed.</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void search.refetch()}
							>
								Try again
							</Button>
						</div>
					) : results.length > 0 ? (
						<CommandGroup heading="Results">
							{results.map((item) => (
								<CommandItem
									key={`${item.kind}:${item.id}`}
									value={`${item.kind}:${item.id}`}
									onSelect={() => {
										close();
										router.push(item.path);
									}}
								>
									{item.icon ? (
										<span aria-hidden>{item.icon}</span>
									) : item.kind === "canvas" ? (
										<ShapesIcon className="text-muted-foreground" />
									) : item.kind === "task" ? (
										<CheckSquareIcon className="text-muted-foreground" />
									) : (
										<FileTextIcon className="text-muted-foreground" />
									)}
									<div className="flex min-w-0 flex-col">
										<span className="truncate">{item.title || "Untitled"}</span>
										<span className="truncate text-muted-foreground text-xs">
											{
												{
													page: "Page",
													task: item.completed ? "Completed task" : "Task",
													canvas: "Canvas",
												}[item.kind]
											}
											{item.pageTitle ? ` · ${item.pageTitle}` : ""}
										</span>
										{item.snippet ? (
											<span className="truncate text-muted-foreground text-xs">
												{item.snippet}
											</span>
										) : null}
									</div>
								</CommandItem>
							))}
							{search.hasNextPage && (
								<CommandItem
									value="load-more"
									disabled={search.isFetchingNextPage}
									onSelect={() => void search.fetchNextPage()}
								>
									{search.isFetchingNextPage ? "Loading…" : "Load more results"}
								</CommandItem>
							)}
							{search.isFetchNextPageError && (
								<p role="alert" className="px-3 py-2 text-sm text-destructive">
									Could not load more results. Try again.
								</p>
							)}
						</CommandGroup>
					) : (
						<div className="py-6 text-center text-muted-foreground text-sm">
							{debounced.length === 0
								? navigation.isFetching
									? "Loading recent pages..."
									: "No recently viewed pages."
								: debounced.length < 2
									? "Type at least 2 characters."
									: search.isFetching || query.trim() !== debounced
										? "Searching..."
										: "No results found."}
						</div>
					)}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
