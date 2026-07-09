"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Panel, PanelHeader } from "@/components/settings/panels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	invalidateNotificationSettings,
	notificationSettingsQueryOptions,
	subscribePushMutationOptions,
	testPushMutationOptions,
	unsubscribePushMutationOptions,
	updateNotificationSettingsMutationOptions,
} from "@/features/notifications/client/queries";
import {
	currentPushSubscription,
	enablePush,
	pushAvailable,
	serializePushSubscription,
} from "@/features/notifications/client/push";

type PushState = "checking" | "enabled" | "disabled" | "unavailable";

export function NotificationSettingsPanel() {
	const queryClient = useQueryClient();
	const settings = useQuery(notificationSettingsQueryOptions());
	const updateSettings = useMutation(
		updateNotificationSettingsMutationOptions(),
	);
	const subscribe = useMutation(subscribePushMutationOptions());
	const unsubscribe = useMutation(unsubscribePushMutationOptions());
	const testPush = useMutation(testPushMutationOptions());
	const [pushState, setPushState] = useState<PushState>("checking");
	const [message, setMessage] = useState<string | null>(null);
	const pending = subscribe.isPending || unsubscribe.isPending;

	useEffect(() => {
		let active = true;
		if (!pushAvailable()) {
			setPushState("unavailable");
			return;
		}
		void currentPushSubscription().then((subscription) => {
			if (active) setPushState(subscription ? "enabled" : "disabled");
		});
		return () => {
			active = false;
		};
	}, []);

	function updateOverdueTasks(checked: boolean) {
		setMessage(null);
		updateSettings.mutate(
			{ body: { overdueTasksEnabled: checked } },
			{ onSuccess: () => invalidateNotificationSettings(queryClient) },
		);
	}

	async function updatePush(checked: boolean) {
		setMessage(null);
		try {
			if (checked) {
				const publicKey = settings.data?.vapidPublicKey;
				if (!publicKey) throw new Error("Push is not configured for Haunter.");
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
			setMessage(
				error instanceof Error ? error.message : "Push could not be updated.",
			);
		}
	}

	async function sendTest() {
		setMessage(null);
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
			setMessage(
				result.sent
					? "Test notification sent."
					: "Test notification could not be sent.",
			);
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: "Test notification could not be sent.",
			);
		}
	}

	if (settings.isPending) {
		return (
			<Panel>
				<PanelHeader title="Notifications" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
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
							? `Uses ${value?.timezone ?? "UTC"} for delivery.`
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
		</Panel>
	);
}
