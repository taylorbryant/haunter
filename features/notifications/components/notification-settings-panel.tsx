"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { isContractError } from "@beignet/core/client";
import { userErrorMessage } from "@/client/error-feedback";
import { Panel, PanelHeader } from "@/components/settings/panels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	currentPushSubscription,
	enablePush,
	pushAvailable,
	serializePushSubscription,
} from "@/features/notifications/client/push";
import {
	invalidateNotificationSettings,
	notificationSettingsQueryOptions,
	optimisticallyUpdateNotificationSettings,
	pushSubscriptionStatusMutationOptions,
	subscribePushMutationOptions,
	testPushMutationOptions,
	unsubscribePushMutationOptions,
	updateNotificationSettingsMutationOptions,
} from "@/features/notifications/client/queries";
import { getBrowserTimezone } from "@/features/notifications/client/timezone";
import type { PushSubscriptionStatus } from "@/features/notifications/schemas";

type PushState = "checking" | PushSubscriptionStatus;

export function NotificationSettingsPanel() {
	const queryClient = useQueryClient();
	const settings = useQuery(notificationSettingsQueryOptions());
	const updateSettings = useMutation({
		...updateNotificationSettingsMutationOptions({
			onSuccess: (result) => {
				queryClient.setQueryData(
					notificationSettingsQueryOptions().queryKey,
					result,
				);
			},
		}),
		meta: { errorMode: "inline" },
		onMutate: (variables) =>
			optimisticallyUpdateNotificationSettings(queryClient, variables.body),
		onError: (_error, _variables, context) => {
			if (context?.previous) {
				queryClient.setQueryData(context.queryKey, context.previous);
			}
			void invalidateNotificationSettings(queryClient);
		},
	});
	const subscribe = useMutation({
		...subscribePushMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const unsubscribe = useMutation({
		...unsubscribePushMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const testPush = useMutation({
		...testPushMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const { mutateAsync: checkPushSubscription } = useMutation({
		...pushSubscriptionStatusMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [pushState, setPushState] = useState<PushState>("checking");
	const [updatingPush, setUpdatingPush] = useState(false);
	const [browserTimezone, setBrowserTimezone] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const pending =
		updatingPush ||
		subscribe.isPending ||
		unsubscribe.isPending ||
		testPush.isPending;

	useEffect(() => {
		setBrowserTimezone(getBrowserTimezone());
	}, []);

	useEffect(() => {
		let active = true;
		if (!pushAvailable()) {
			setPushState("unavailable");
			return;
		}
		void currentPushSubscription()
			.then(async (subscription) => {
				return subscription
					? (
							await checkPushSubscription({
								body: { endpoint: subscription.endpoint },
							})
						).status
					: ("disabled" as const);
			})
			.then(
				(status) => {
					if (active) setPushState(status);
				},
				(subscriptionError) => {
					if (!active) return;
					setPushState("unavailable");
					setError(
						userErrorMessage(
							subscriptionError,
							"Push notification status could not be checked.",
						),
					);
				},
			);
		return () => {
			active = false;
		};
	}, [checkPushSubscription]);

	function updateOverdueTasks(checked: boolean) {
		setMessage(null);
		setError(null);
		updateSettings.mutate(
			{ body: { overdueTasksEnabled: checked } },
			{
				onError: (updateError) =>
					setError(
						userErrorMessage(
							updateError,
							"Notification settings could not be updated.",
						),
					),
			},
		);
	}

	function updateTaskAssignments(checked: boolean) {
		setMessage(null);
		setError(null);
		updateSettings.mutate(
			{ body: { taskAssignmentsEnabled: checked } },
			{
				onError: (updateError) =>
					setError(
						userErrorMessage(
							updateError,
							"Notification settings could not be updated.",
						),
					),
			},
		);
	}

	function updateTaskReminders(checked: boolean) {
		setMessage(null);
		setError(null);
		updateSettings.mutate(
			{ body: { taskRemindersEnabled: checked } },
			{
				onError: (updateError) =>
					setError(
						userErrorMessage(
							updateError,
							"Notification settings could not be updated.",
						),
					),
			},
		);
	}

	async function applyCurrentTimezone() {
		if (!browserTimezone) return;
		setMessage(null);
		setError(null);
		try {
			await updateSettings.mutateAsync({
				body: { timezone: browserTimezone },
			});
			setMessage(`Delivery timezone updated to ${browserTimezone}.`);
		} catch (error) {
			setError(userErrorMessage(error, "Timezone could not be updated."));
		}
	}

	async function updatePush(checked: boolean) {
		setUpdatingPush(true);
		setMessage(null);
		setError(null);
		try {
			if (checked) {
				const publicKey = settings.data?.vapidPublicKey;
				if (!publicKey) {
					setError("Push is not configured for Haunter.");
					return;
				}
				const browserSubscription = await enablePush(publicKey);
				await subscribe.mutateAsync({
					body: serializePushSubscription(browserSubscription),
				});
				setPushState("enabled");
				setMessage("Push notifications enabled on this device.");
				return;
			}

			const browserSubscription = await currentPushSubscription();
			if (browserSubscription) {
				await unsubscribe.mutateAsync({
					body: { endpoint: browserSubscription.endpoint },
				});
				await browserSubscription.unsubscribe();
			}
			setPushState("disabled");
			setMessage("Push notifications disabled on this device.");
		} catch (error) {
			showPushError(error, "Push could not be updated.");
		} finally {
			setUpdatingPush(false);
		}
	}

	function showPushError(error: unknown, fallback: string) {
		if (isContractError(error)) {
			if (error.code === "UNSUPPORTED_PUSH_SERVICE") {
				setPushState("unsupported-service");
				setError(null);
				return;
			}
			if (error.code === "INVALID_PUSH_SUBSCRIPTION") {
				setPushState("invalid-subscription");
				setError(null);
				return;
			}
		}
		setError(userErrorMessage(error, fallback));
	}

	async function sendTest() {
		setMessage(null);
		setError(null);
		try {
			const browserSubscription = await currentPushSubscription();
			if (!browserSubscription) {
				setPushState("disabled");
				setMessage("Push is no longer enabled on this device.");
				return;
			}
			const result = await testPush.mutateAsync({
				body: { endpoint: browserSubscription.endpoint },
			});
			if (result.sent) {
				setMessage("Test notification sent.");
			} else {
				const { status } = await checkPushSubscription({
					body: { endpoint: browserSubscription.endpoint },
				});
				setPushState(status);
				setError("Test notification could not be sent.");
			}
		} catch (error) {
			showPushError(error, "Test notification could not be sent.");
		}
	}

	if (settings.isPending) {
		return (
			<Panel>
				<PanelHeader title="Notifications" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
			</Panel>
		);
	}

	if (!settings.data) {
		return (
			<Panel>
				<PanelHeader title="Notifications" />
				<div
					role="alert"
					className="flex items-center gap-3 text-destructive text-sm"
				>
					<span className="flex-1">
						Notification settings could not be loaded.
					</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void settings.refetch()}
					>
						Try again
					</Button>
				</div>
			</Panel>
		);
	}

	const value = settings.data;
	const pushSupported =
		Boolean(value?.pushSupported) && pushState !== "unavailable";
	const pushIssue =
		pushState === "unsupported-service"
			? "This browser's push service is not supported. Try another browser or use in-app notifications."
			: pushState === "invalid-subscription"
				? "This device's push subscription is invalid. Remove it and enable push again."
				: null;

	return (
		<Panel>
			<PanelHeader
				title="Notifications"
				description="Choose when Haunter should get your attention."
			/>
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-0.5">
					<label
						htmlFor="task-assignment-notifications"
						className="font-medium text-sm"
					>
						Task assignments
					</label>
					<p className="text-muted-foreground text-sm">
						Notify me when another member assigns me a task.
					</p>
				</div>
				<Switch
					id="task-assignment-notifications"
					checked={value.taskAssignmentsEnabled}
					disabled={updateSettings.isPending}
					onCheckedChange={updateTaskAssignments}
				/>
			</div>
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-0.5">
					<label
						htmlFor="task-reminder-notifications"
						className="font-medium text-sm"
					>
						Task reminders
					</label>
					<p className="text-muted-foreground text-sm">
						Notify me when a reminder I set for an assigned task is due.
					</p>
				</div>
				<Switch
					id="task-reminder-notifications"
					checked={value.taskRemindersEnabled}
					disabled={updateSettings.isPending}
					onCheckedChange={updateTaskReminders}
				/>
			</div>
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-0.5">
					<label
						htmlFor="overdue-task-notifications"
						className="font-medium text-sm"
					>
						Overdue tasks
					</label>
					<p className="text-muted-foreground text-sm">
						Notify me around 9:00 AM when an assigned task is overdue.
					</p>
				</div>
				<Switch
					id="overdue-task-notifications"
					checked={value?.overdueTasksEnabled ?? true}
					disabled={updateSettings.isPending}
					onCheckedChange={updateOverdueTasks}
				/>
			</div>
			<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<div className="flex min-w-0 flex-col gap-0.5">
					<p className="font-medium text-sm">Delivery timezone</p>
					<p className="text-muted-foreground text-sm">
						Date-only reminders and overdue tasks use 9:00 AM in{" "}
						{value.timezone}.
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="shrink-0"
					disabled={
						!browserTimezone ||
						updateSettings.isPending ||
						(Boolean(value?.timezoneConfigured) &&
							browserTimezone === value?.timezone)
					}
					onClick={applyCurrentTimezone}
				>
					Use current timezone
				</Button>
			</div>
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-0.5">
					<label
						htmlFor="device-push-notifications"
						className="font-medium text-sm"
					>
						Push on this device
					</label>
					<p className="text-muted-foreground text-sm">
						{pushIssue ??
							(pushSupported
								? "Receive task reminders, assignments, and overdue alerts when Haunter is closed."
								: "Push is unavailable in this browser or installation.")}
					</p>
				</div>
				<Switch
					id="device-push-notifications"
					checked={pushState === "enabled"}
					disabled={
						!pushSupported ||
						Boolean(pushIssue) ||
						pushState === "checking" ||
						pending
					}
					onCheckedChange={updatePush}
				/>
			</div>
			{pushIssue ? (
				<div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={pending}
						onClick={() => updatePush(false)}
					>
						Remove device subscription
					</Button>
				</div>
			) : null}
			{pushState === "enabled" ? (
				<div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={pending}
						onClick={sendTest}
					>
						Send test notification
					</Button>
				</div>
			) : null}
			{message ? (
				<p className="text-muted-foreground text-sm" role="status">
					{message}
				</p>
			) : null}
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
		</Panel>
	);
}
