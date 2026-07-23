"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CornerDownLeftIcon, FileTextIcon } from "lucide-react";
import { useRouter } from "next/navigation";
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
} from "@/components/ui/command";
import { searchPagesQueryOptions } from "@/features/pages/client/queries";

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
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");

	const isCommandMode = query.startsWith(COMMAND_PREFIX);
	const commandQuery = isCommandMode ? query.slice(COMMAND_PREFIX.length) : "";
	const debounced = useDebouncedValue(query.trim(), 200);

	const search = useQuery({
		...searchPagesQueryOptions(debounced),
		enabled: open && !isCommandMode && debounced.length >= 2,
		placeholderData: keepPreviousData,
	});

	const pageItems =
		!isCommandMode && debounced.length >= 2 ? (search.data?.items ?? []) : [];
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
					: "Search pages by title or content, or type > for commands"
			}
			initialFocus={inputRef}
		>
			<Command shouldFilter={false}>
				<CommandInput
					ref={inputRef}
					placeholder={
						isCommandMode
							? "Type a command..."
							: "Search pages, or > for commands..."
					}
					value={query}
					onValueChange={setQuery}
				/>
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
										</CommandItem>
									))}
								</CommandGroup>
							))
						) : (
							<div className="py-6 text-center text-muted-foreground text-sm">
								No matching commands.
							</div>
						)
					) : search.isError ? (
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
					) : pageItems.length > 0 ? (
						<CommandGroup heading="Pages">
							{pageItems.map((item) => (
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
										<span className="truncate">{item.title || "Untitled"}</span>
										{item.snippet ? (
											<span className="truncate text-muted-foreground text-xs">
												{item.snippet}
											</span>
										) : null}
									</div>
								</CommandItem>
							))}
						</CommandGroup>
					) : (
						<div className="py-6 text-center text-muted-foreground text-sm">
							{debounced.length === 0
								? "Search pages, or type > for commands."
								: debounced.length < 2
									? "Type at least 2 characters."
									: search.isFetching
										? "Searching..."
										: "No pages found."}
						</div>
					)}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
