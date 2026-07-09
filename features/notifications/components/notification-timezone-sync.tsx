"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	invalidateNotificationSettings,
	notificationSettingsQueryOptions,
	updateNotificationSettingsMutationOptions,
} from "@/features/notifications/client/queries";

export function NotificationTimezoneSync() {
	const queryClient = useQueryClient();
	const settings = useQuery(notificationSettingsQueryOptions());
	const updateSettings = useMutation(
		updateNotificationSettingsMutationOptions(),
	);
	const attempted = useRef(false);

	useEffect(() => {
		if (!settings.data || attempted.current) return;
		attempted.current = true;
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!timezone || timezone === settings.data.timezone) return;
		updateSettings.mutate(
			{ body: { timezone } },
			{ onSuccess: () => invalidateNotificationSettings(queryClient) },
		);
	}, [queryClient, settings.data, updateSettings]);

	return null;
}
