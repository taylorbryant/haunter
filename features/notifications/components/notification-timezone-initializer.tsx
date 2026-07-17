"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	initializeNotificationTimezoneMutationOptions,
	invalidateNotificationSettings,
	notificationSettingsQueryOptions,
} from "@/features/notifications/client/queries";
import { getBrowserTimezone } from "@/features/notifications/client/timezone";

export function NotificationTimezoneInitializer() {
	const queryClient = useQueryClient();
	const settings = useQuery(notificationSettingsQueryOptions());
	const initializeTimezone = useMutation({
		...initializeNotificationTimezoneMutationOptions(),
		meta: { errorMode: "silent" },
		retry: 2,
	});
	const attempted = useRef(false);

	useEffect(() => {
		if (
			!settings.data ||
			settings.data.timezoneConfigured ||
			attempted.current
		) {
			return;
		}
		attempted.current = true;
		const timezone = getBrowserTimezone();
		if (!timezone) return;
		initializeTimezone.mutate(
			{ body: { timezone } },
			{ onSuccess: () => invalidateNotificationSettings(queryClient) },
		);
	}, [initializeTimezone, queryClient, settings.data]);

	return null;
}
