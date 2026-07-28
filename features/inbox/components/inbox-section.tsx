"use client";

import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	CalendarClockIcon,
	CheckIcon,
	FileTextIcon,
	InboxIcon,
	MoreHorizontalIcon,
	PlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { userErrorMessage } from "@/client/error-feedback";
import { useDeviceTime } from "@/components/device-time-provider";
import { DueDatePicker } from "@/components/due-date-picker";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
	invalidateInboxItems,
	listInboxItemsInfiniteQueryOptions,
	resolveInboxItemMutationOptions,
} from "@/features/inbox/client/queries";
import { useCapture } from "@/features/inbox/components/capture-provider";
import type { InboxItem } from "@/features/inbox/schemas";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	invalidatePageNavigation,
	invalidatePages,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import { formatViewedAt } from "@/features/pages/lib/format-viewed-at";
import type { PageMeta } from "@/features/pages/schemas";
import {
	invalidateTasks,
	updateTaskMutationOptions,
} from "@/features/tasks/client/queries";

type InboxItemAction =
	| { action: "dismiss" }
	| { action: "file_page"; parentPageId: string | null }
	| {
			action: "schedule_task";
			dueDate: string;
			dueTime?: string | null;
	  }
	| { action: "clear_task_due" }
	| { action: "complete_task" };

function availableDestinations(pages: PageMeta[], pageId: string) {
	const children = new Map<string, string[]>();
	for (const page of pages) {
		if (!page.parentPageId) continue;
		const current = children.get(page.parentPageId) ?? [];
		current.push(page.id);
		children.set(page.parentPageId, current);
	}
	const excluded = new Set([pageId]);
	const queue = [pageId];
	for (let index = 0; index < queue.length; index += 1) {
		const id = queue[index];
		if (!id) continue;
		for (const childId of children.get(id) ?? []) {
			if (excluded.has(childId)) continue;
			excluded.add(childId);
			queue.push(childId);
		}
	}
	return pages.filter((page) => !excluded.has(page.id));
}

function PageDestinationPicker({
	item,
	pages,
	pending,
	loading,
	loadError,
	onRetry,
	onFile,
}: {
	item: Extract<InboxItem, { kind: "page" }>;
	pages: PageMeta[];
	pending: boolean;
	loading: boolean;
	loadError: boolean;
	onRetry: () => void;
	onFile: (parentPageId: string | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const destinations = availableDestinations(pages, item.page.id);

	useEffect(() => {
		if (pending) setOpen(false);
	}, [pending]);

	function choose(parentPageId: string | null) {
		if (pending) return;
		setOpen(false);
		onFile(parentPageId);
	}

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!pending) setOpen(nextOpen);
			}}
		>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={pending || loading}
					/>
				}
			>
				{loading ? "Loading…" : "File"}
			</PopoverTrigger>
			<PopoverContent className="w-72 p-0" align="end">
				{loadError ? (
					<div className="flex flex-col items-start gap-2 p-3">
						<p className="text-muted-foreground text-sm">
							Page destinations could not be loaded.
						</p>
						<Button type="button" variant="outline" size="sm" onClick={onRetry}>
							Try again
						</Button>
					</div>
				) : (
					<Command>
						<CommandInput placeholder="Find a page…" />
						<CommandList>
							<CommandEmpty>No matching pages.</CommandEmpty>
							<CommandGroup heading="Destination">
								<CommandItem
									value="Workspace root"
									onSelect={() => choose(null)}
								>
									<InboxIcon />
									Workspace root
								</CommandItem>
								{destinations.map((page) => (
									<CommandItem
										key={page.id}
										value={`${page.title} ${page.id}`}
										onSelect={() => choose(page.id)}
									>
										<FileTextIcon />
										<span className="truncate">{page.title || "Untitled"}</span>
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				)}
			</PopoverContent>
		</Popover>
	);
}

function InboxItemRow({
	item,
	pages,
	pagesLoading,
	pagesError,
	onPagesRetry,
	canEdit,
	onResolve,
	pending,
}: {
	item: InboxItem;
	pages: PageMeta[];
	pagesLoading: boolean;
	pagesError: boolean;
	onPagesRetry: () => void;
	canEdit: boolean;
	onResolve: (item: InboxItem, action: InboxItemAction) => void;
	pending: boolean;
}) {
	const deviceTime = useDeviceTime();
	const title = item.kind === "page" ? item.page.title : item.task.title;

	return (
		<li className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center">
			<div className="flex min-w-0 flex-1 items-start gap-3">
				{item.kind === "page" ? (
					<FileTextIcon
						className="size-5 shrink-0 text-muted-foreground sm:size-4"
						aria-hidden="true"
					/>
				) : (
					<CheckIcon
						className="size-5 shrink-0 text-muted-foreground sm:size-4"
						aria-hidden="true"
					/>
				)}
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-base sm:text-sm">
						{title || "Untitled"}
					</p>
					<p className="text-base text-muted-foreground sm:text-sm">
						{item.kind === "page" ? "Note" : "Task"} ·{" "}
						{formatViewedAt(item.createdAt, deviceTime.timestamp)}
					</p>
				</div>
			</div>

			<div className="flex shrink-0 items-center justify-end gap-1">
				{item.kind === "page" ? (
					<>
						<Button
							variant="ghost"
							size="sm"
							nativeButton={false}
							render={
								<Link href={`/w/${item.workspaceId}/p/${item.page.id}`} />
							}
						>
							Open
						</Button>
						{canEdit ? (
							<PageDestinationPicker
								item={item}
								pages={pages}
								pending={pending}
								loading={pagesLoading}
								loadError={pagesError}
								onRetry={onPagesRetry}
								onFile={(parentPageId) =>
									onResolve(item, { action: "file_page", parentPageId })
								}
							/>
						) : null}
					</>
				) : canEdit ? (
					<>
						<DueDatePicker
							value={item.task.dueDate}
							time={item.task.dueTime}
							ariaLabel={`Schedule ${item.task.title}`}
							disabled={pending}
							className="flex h-7 items-center gap-1 rounded-lg px-2.5 text-base hover:bg-muted sm:text-sm"
							onChange={({ date, time }) => {
								if (date) {
									onResolve(item, {
										action: "schedule_task",
										dueDate: date,
										...(time ? { dueTime: time } : {}),
									});
								} else {
									onResolve(item, { action: "clear_task_due" });
								}
							}}
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={pending}
							onClick={() => onResolve(item, { action: "complete_task" })}
						>
							Complete
						</Button>
					</>
				) : null}

				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`More actions for ${title || "Untitled"}`}
								disabled={pending}
							/>
						}
					>
						<MoreHorizontalIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuGroup>
							<DropdownMenuItem
								onClick={() => onResolve(item, { action: "dismiss" })}
							>
								Dismiss from Inbox
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</li>
	);
}

export function InboxSection({ workspaceId }: { workspaceId: string }) {
	const queryClient = useQueryClient();
	const { openCapture } = useCapture();
	const canEdit = useCanEditWorkspace();
	const inboxQuery = useInfiniteQuery(
		listInboxItemsInfiniteQueryOptions(workspaceId),
	);
	const inboxItems = inboxQuery.data?.pages.flatMap((page) => page.items) ?? [];
	const pagesQuery = useQuery({
		...listPagesQueryOptions(workspaceId),
		enabled: canEdit && inboxItems.some((item) => item.kind === "page"),
	});
	const resolveMutation = useMutation({
		...resolveInboxItemMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const updateTaskMutation = useMutation({
		...updateTaskMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const pendingItemIdRef = useRef<string | null>(null);
	const [pendingItemId, setPendingItemId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function resolve(item: InboxItem, action: InboxItemAction) {
		if (pendingItemIdRef.current) return;
		pendingItemIdRef.current = item.id;
		setPendingItemId(item.id);
		setError(null);
		try {
			switch (action.action) {
				case "dismiss":
					await resolveMutation.mutateAsync({
						path: { id: item.id },
						body: { action: "dismiss" },
					});
					break;
				case "file_page":
					await resolveMutation.mutateAsync({
						path: { id: item.id },
						body: {
							action: "file_page",
							parentPageId: action.parentPageId,
						},
					});
					break;
				case "schedule_task":
					await resolveMutation.mutateAsync({
						path: { id: item.id },
						body: {
							action: "schedule_task",
							dueDate: action.dueDate,
							...(action.dueTime !== undefined
								? { dueTime: action.dueTime }
								: {}),
						},
					});
					break;
				case "clear_task_due":
					if (item.kind !== "task") {
						throw new Error("Only Inbox tasks can clear a due date.");
					}
					await updateTaskMutation.mutateAsync({
						path: { id: item.task.id },
						body: { dueDate: null, dueTime: null },
					});
					break;
				case "complete_task":
					await resolveMutation.mutateAsync({
						path: { id: item.id },
						body: { action: "complete_task" },
					});
					break;
			}
			await Promise.all([
				invalidateInboxItems(queryClient),
				item.kind === "page"
					? invalidatePages(queryClient)
					: invalidateTasks(queryClient),
				item.kind === "page"
					? invalidatePageNavigation(queryClient, workspaceId)
					: Promise.resolve(),
			]);
		} catch (resolveError) {
			setError(
				userErrorMessage(resolveError, "The inbox item could not be updated."),
			);
			await invalidateInboxItems(queryClient);
		} finally {
			pendingItemIdRef.current = null;
			setPendingItemId(null);
		}
	}

	return (
		<section className="flex flex-col gap-3" aria-labelledby="inbox-heading">
			<div className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<h2 id="inbox-heading" className="font-medium text-base sm:text-sm">
						Inbox
					</h2>
					{inboxItems.length ? (
						<p className="text-base text-muted-foreground tabular-nums sm:text-sm">
							{inboxItems.length}
							{inboxQuery.hasNextPage ? "+" : ""}
						</p>
					) : null}
				</div>
				{canEdit ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => openCapture()}
					>
						<PlusIcon data-icon="inline-start" />
						Capture
					</Button>
				) : null}
			</div>

			{error ? (
				<p role="alert" className="text-destructive text-base sm:text-sm">
					{error}
				</p>
			) : null}

			{inboxQuery.isPending && !inboxQuery.data ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-16 w-full" />
				</div>
			) : inboxQuery.isError && !inboxQuery.data ? (
				<Empty className="min-h-32 border">
					<EmptyHeader>
						<EmptyTitle>Inbox unavailable</EmptyTitle>
						<EmptyDescription>
							Your captured items could not be loaded.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => inboxQuery.refetch()}
						>
							Try again
						</Button>
					</EmptyContent>
				</Empty>
			) : inboxItems.length ? (
				<div className="flex flex-col gap-2">
					<ul className="divide-y rounded-xl border">
						{inboxItems.map((item) => (
							<InboxItemRow
								key={item.id}
								item={item}
								pages={pagesQuery.data?.items ?? []}
								pagesLoading={pagesQuery.isPending && !pagesQuery.data}
								pagesError={pagesQuery.isError && !pagesQuery.data}
								onPagesRetry={() => void pagesQuery.refetch()}
								canEdit={canEdit}
								pending={pendingItemId !== null}
								onResolve={resolve}
							/>
						))}
					</ul>
					{inboxQuery.hasNextPage ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="self-center"
							disabled={inboxQuery.isFetchingNextPage}
							onClick={() => void inboxQuery.fetchNextPage()}
						>
							{inboxQuery.isFetchingNextPage ? "Loading…" : "Load more"}
						</Button>
					) : null}
				</div>
			) : (
				<Empty className="min-h-32 border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<InboxIcon />
						</EmptyMedia>
						<EmptyTitle>Your Inbox is clear</EmptyTitle>
						<EmptyDescription>
							Capture a note or task now and organize it later.
						</EmptyDescription>
					</EmptyHeader>
					{canEdit ? (
						<EmptyContent>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => openCapture()}
							>
								<CalendarClockIcon data-icon="inline-start" />
								Quick capture
							</Button>
						</EmptyContent>
					) : null}
				</Empty>
			)}
		</section>
	);
}
