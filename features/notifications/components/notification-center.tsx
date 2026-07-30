"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BellIcon,
	BellOffIcon,
	CheckCheckIcon,
	CheckIcon,
	FileTextIcon,
	TimerIcon,
	UserRoundCheckIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { reportUserError } from "@/client/error-feedback";
import { useDeviceTime } from "@/components/device-time-provider";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import {
	invalidateNotifications,
	listNotificationsQueryOptions,
	markAllNotificationsReadMutationOptions,
	markNotificationReadMutationOptions,
} from "@/features/notifications/client/queries";
import type { Notification } from "@/features/notifications/schemas";
import { invalidatePage } from "@/features/pages/client/queries";
import {
	actOnTaskNotificationMutationOptions,
	invalidateTasks,
} from "@/features/tasks/client/queries";
import { formatDueDateTimeLabel, parseIsoDate } from "@/lib/due-date";
import { cn } from "@/lib/utils";

type BadgeNavigator = Navigator & {
	setAppBadge?: (count?: number) => Promise<void>;
	clearAppBadge?: () => Promise<void>;
};

function notificationUrl(item: Notification) {
	if (item.payload.pageId) {
		const block = item.payload.sourceBlockId
			? `?block=${encodeURIComponent(item.payload.sourceBlockId)}`
			: "";
		return `/w/${item.workspaceId}/p/${item.payload.pageId}${block}`;
	}
	return `/w/${item.workspaceId}/tasks?scope=mine`;
}

function NotificationPanel({
	items,
	unreadCount,
	loading,
	error,
	onRetry,
	onOpen,
	onMarkAll,
	markingAll,
	onAction,
	pendingItemIds,
}: {
	items: Notification[];
	unreadCount: number;
	loading: boolean;
	error: boolean;
	onRetry: () => void;
	onOpen: (item: Notification) => void;
	onMarkAll: () => void;
	markingAll: boolean;
	onAction: (
		item: Notification,
		action:
			| { action: "complete" }
			| {
					action: "snooze";
					preset: "15m" | "1h" | "tomorrow_9am";
			  },
	) => void;
	pendingItemIds: ReadonlySet<string>;
}) {
	const deviceTime = useDeviceTime();

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
				<h2 className="font-semibold text-sm">Notifications</h2>
				{unreadCount > 0 ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={markingAll}
						onClick={onMarkAll}
					>
						<CheckCheckIcon />
						Mark all read
					</Button>
				) : null}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{loading ? (
					<div
						className="space-y-1 p-2"
						role="status"
						aria-label="Loading notifications"
					>
						{["a", "b", "c"].map((key) => (
							<div key={key} className="flex gap-3 p-2.5">
								<Skeleton className="size-8 shrink-0 rounded-md" />
								<div className="flex-1 space-y-2">
									<Skeleton className="h-3 w-3/4" />
									<Skeleton className="h-3 w-1/2" />
								</div>
							</div>
						))}
					</div>
				) : error ? (
					<div className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center">
						<p role="alert" className="text-destructive text-sm">
							Notifications could not be loaded.
						</p>
						<Button type="button" variant="outline" size="sm" onClick={onRetry}>
							Try again
						</Button>
					</div>
				) : items.length === 0 ? (
					<div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 text-center">
						<BellOffIcon className="size-5 text-muted-foreground" />
						<p className="font-medium text-sm">You’re all caught up</p>
						<p className="text-muted-foreground text-xs">
							Task reminders, assignments, and overdue alerts will appear here.
						</p>
					</div>
				) : (
					<div className="divide-y">
						{items.map((item) => {
							const pending = pendingItemIds.has(item.id);
							const actionable =
								item.actionState === null &&
								item.taskAvailable &&
								!item.taskCompleted &&
								item.taskAssigneeId === item.userId;
							const canComplete = actionable && item.taskCanComplete === true;
							const canSnooze = actionable && item.kind !== "task.assigned";
							return (
								<div
									key={item.id}
									className={cn(
										"flex w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60",
										item.readAt === null && "bg-muted/30",
									)}
								>
									<span
										className={cn(
											"mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
											item.kind === "task.assigned"
												? "bg-primary/10 text-primary"
												: item.kind === "task.reminder"
													? "bg-primary/10 text-primary"
													: "bg-destructive/10 text-destructive",
										)}
									>
										{item.kind === "task.assigned" ? (
											<UserRoundCheckIcon className="size-4" />
										) : item.kind === "task.reminder" ? (
											<BellIcon className="size-4" />
										) : (
											<FileTextIcon className="size-4" />
										)}
									</span>
									<div className="min-w-0 flex-1">
										<button
											type="button"
											className="block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
											onClick={() => onOpen(item)}
										>
											<span className="block break-words font-medium text-sm">
												{item.kind === "task.assigned"
													? `${item.payload.assignedByName} assigned you a task`
													: item.payload.title}
											</span>
											<span className="mt-0.5 block text-muted-foreground text-xs">
												{item.kind === "task.assigned" ? (
													item.payload.title
												) : (
													<>
														{item.kind === "task.reminder"
															? "Reminder"
															: "Overdue"}{" "}
														·{" "}
														{deviceTime.ready
															? formatDueDateTimeLabel(
																	item.payload.dueDate,
																	item.payload.dueTime,
																	parseIsoDate(deviceTime.today),
																)
															: item.payload.dueDate}
													</>
												)}
											</span>
										</button>
										{item.actionState === "completed" || item.taskCompleted ? (
											<span className="mt-2 inline-flex items-center gap-1 font-medium text-muted-foreground text-xs">
												<CheckIcon className="size-3" />
												Completed
											</span>
										) : canComplete || canSnooze ? (
											<div className="mt-2 flex items-center gap-1">
												{canComplete ? (
													<Button
														type="button"
														variant="ghost"
														size="xs"
														disabled={pending}
														onClick={() =>
															onAction(item, { action: "complete" })
														}
													>
														<CheckIcon />
														Complete
													</Button>
												) : null}
												{canSnooze ? (
													<DropdownMenu>
														<DropdownMenuTrigger
															render={
																<Button
																	type="button"
																	variant="ghost"
																	size="xs"
																	disabled={pending}
																/>
															}
														>
															<TimerIcon />
															Snooze
														</DropdownMenuTrigger>
														<DropdownMenuContent align="start">
															<DropdownMenuItem
																onClick={() =>
																	onAction(item, {
																		action: "snooze",
																		preset: "15m",
																	})
																}
															>
																15 minutes
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() =>
																	onAction(item, {
																		action: "snooze",
																		preset: "1h",
																	})
																}
															>
																1 hour
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() =>
																	onAction(item, {
																		action: "snooze",
																		preset: "tomorrow_9am",
																	})
																}
															>
																Tomorrow at 9:00 AM
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												) : null}
											</div>
										) : null}
									</div>
									{item.readAt === null && !item.taskCompleted ? (
										<>
											<span
												className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
												aria-hidden
											/>
											<span className="sr-only">Unread</span>
										</>
									) : null}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

export function NotificationCenter() {
	const { isMobile, setOpenMobile } = useSidebar();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(
		() => new Set(),
	);
	const pendingActionIdsRef = useRef(new Set<string>());
	const query = useQuery(listNotificationsQueryOptions());
	const markRead = useMutation({
		...markNotificationReadMutationOptions(),
		meta: { errorMode: "silent" },
	});
	const markAll = useMutation(markAllNotificationsReadMutationOptions());
	const action = useMutation({
		...actOnTaskNotificationMutationOptions(),
		meta: { errorMode: "silent" },
	});
	const items = query.data?.items ?? [];
	const unreadCount = query.data?.unreadCount ?? 0;

	useEffect(() => {
		const badgeNavigator = navigator as BadgeNavigator;
		const update =
			unreadCount > 0
				? badgeNavigator.setAppBadge?.(unreadCount)
				: badgeNavigator.clearAppBadge?.();
		void update?.catch(() => undefined);
	}, [unreadCount]);

	useEffect(() => {
		if (!("serviceWorker" in navigator)) return;
		const onMessage = (event: MessageEvent) => {
			if (event.data?.type === "haunter:push-received") {
				void invalidateNotifications(queryClient);
			}
		};
		navigator.serviceWorker.addEventListener("message", onMessage);
		return () =>
			navigator.serviceWorker.removeEventListener("message", onMessage);
	}, [queryClient]);

	function openNotification(item: Notification) {
		setOpen(false);
		if (isMobile) setOpenMobile(false);
		if (item.readAt === null) {
			markRead.mutate(
				{ path: { id: item.id } },
				{ onSettled: () => invalidateNotifications(queryClient) },
			);
		}
		router.push(notificationUrl(item));
	}

	function markAllRead() {
		markAll.mutate(
			{ body: {} },
			{ onSuccess: () => invalidateNotifications(queryClient) },
		);
	}

	async function actOnNotification(
		item: Notification,
		request:
			| { action: "complete" }
			| {
					action: "snooze";
					preset: "15m" | "1h" | "tomorrow_9am";
			  },
	) {
		if (pendingActionIdsRef.current.has(item.id)) return;
		pendingActionIdsRef.current.add(item.id);
		setPendingActionIds((current) => new Set(current).add(item.id));
		const variables =
			request.action === "complete"
				? { path: { id: item.id }, body: { action: "complete" as const } }
				: {
						path: { id: item.id },
						body: {
							action: "snooze" as const,
							preset: request.preset,
						},
					};
		try {
			const result = await action.mutateAsync(variables);
			await Promise.all([
				invalidateNotifications(queryClient),
				invalidateTasks(queryClient),
				result.pageId
					? invalidatePage(queryClient, result.pageId)
					: Promise.resolve(),
			]);
		} catch (error) {
			reportUserError(error, "The notification could not be updated.");
		} finally {
			pendingActionIdsRef.current.delete(item.id);
			setPendingActionIds((current) => {
				const next = new Set(current);
				next.delete(item.id);
				return next;
			});
		}
	}

	const triggerLabel =
		unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications";
	const triggerContent = (
		<>
			<BellIcon />
			{unreadCount > 0 ? (
				<span
					className="absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground leading-4 md:-top-1 md:-right-1"
					aria-hidden
				>
					{unreadCount > 9 ? "9+" : unreadCount}
				</span>
			) : null}
		</>
	);

	const panel = (
		<NotificationPanel
			items={items}
			unreadCount={unreadCount}
			loading={query.isPending}
			error={query.isError && !query.data}
			onRetry={() => void query.refetch()}
			onOpen={openNotification}
			onMarkAll={markAllRead}
			markingAll={markAll.isPending}
			onAction={actOnNotification}
			pendingItemIds={pendingActionIds}
		/>
	);

	if (isMobile) {
		return (
			<SidebarMenuItem className="w-fit">
				<Drawer showSwipeHandle open={open} onOpenChange={setOpen}>
					<SidebarMenuButton
						render={<DrawerTrigger />}
						tooltip="Notifications"
						title="Notifications"
						aria-label={triggerLabel}
						className="relative size-11! justify-center overflow-visible! p-0! md:size-8!"
					>
						{triggerContent}
					</SidebarMenuButton>
					<DrawerContent className="h-[70dvh]">
						<DrawerHeader className="sr-only">
							<DrawerTitle>Notifications</DrawerTitle>
							<DrawerDescription>Your recent notifications</DrawerDescription>
						</DrawerHeader>
						{panel}
					</DrawerContent>
				</Drawer>
			</SidebarMenuItem>
		);
	}

	return (
		<SidebarMenuItem className="w-fit">
			<Popover open={open} onOpenChange={setOpen}>
				<SidebarMenuButton
					render={<PopoverTrigger />}
					tooltip="Notifications"
					title="Notifications"
					aria-label={triggerLabel}
					className="relative size-8! justify-center overflow-visible! p-0!"
				>
					{triggerContent}
				</SidebarMenuButton>
				<PopoverContent
					side="right"
					align="start"
					sideOffset={8}
					className="h-[min(520px,70dvh)] w-96 gap-0 overflow-hidden p-0"
				>
					{panel}
				</PopoverContent>
			</Popover>
		</SidebarMenuItem>
	);
}
