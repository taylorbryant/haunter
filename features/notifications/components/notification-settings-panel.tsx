"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
	subscribePushMutationOptions,
	testPushMutationOptions,
	unsubscribePushMutationOptions,
	updateNotificationSettingsMutationOptions,
} from "@/features/notifications/client/queries";
import { getBrowserTimezone } from "@/features/notifications/client/timezone";

type PushState = "checking" | "enabled" | "disabled" | "unavailable";

export function NotificationSettingsPanel() {
	const queryClient = useQueryClient();
	const settings = useQuery(notificationSettingsQueryOptions());
	const updateSettings = useMutation({
		...updateNotificationSettingsMutationOptions(),
		meta: { errorMode: "inline" },
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
	const [pushState, setPushState] = useState<PushState>("checking");
	const [browserTimezone, setBrowserTimezone] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const pending = subscribe.isPending || unsubscribe.isPending;

	useEffect(() => {
		setBrowserTimezone(getBrowserTimezone());
	}, []);

	useEffect(() => {
		let active = true;
		if (!pushAvailable()) {
			setPushState("unavailable");
			return;
		}
		void currentPushSubscription().then(
			(subscription) => {
				if (active) setPushState(subscription ? "enabled" : "disabled");
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
	}, []);

	function updateOverdueTasks(checked: boolean) {
		setMessage(null);
		setError(null);
		updateSettings.mutate(
			{ body: { overdueTasksEnabled: checked } },
			{
				onSuccess: () => void invalidateNotificationSettings(queryClient),
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
				onSuccess: () => void invalidateNotificationSettings(queryClient),
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
				onSuccess: () => void invalidateNotificationSettings(queryClient),
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

	async function useCurrentTimezone() {
		if (!browserTimezone) return;
		setMessage(null);
		setError(null);
		try {
			await updateSettings.mutateAsync({
				body: { timezone: browserTimezone },
			});
			await invalidateNotificationSettings(queryClient);
			setMessage(`Delivery timezone updated to ${browserTimezone}.`);
		} catch (error) {
			setError(userErrorMessage(error, "Timezone could not be updated."));
		}
	}

	async function updatePush(checked: boolean) {
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
			setError(userErrorMessage(error, "Push could not be updated."));
		}
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
				setError("Test notification could not be sent.");
			}
		} catch (error) {
			setError(userErrorMessage(error, "Test notification could not be sent."));
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
					onClick={useCurrentTimezone}
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
						{pushSupported
							? "Receive task reminders, assignments, and overdue alerts when Haunter is closed."
							: "Push is unavailable in this browser or installation."}
					</p>
				</div>
				<Switch
					id="device-push-notifications"
					checked={pushState === "enabled"}
					disabled={!pushSupported || pushState === "checking" || pending}
					onCheckedChange={updatePush}
				/>
			</div>
			{pushState === "enabled" ? (
				<div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={testPush.isPending}
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
