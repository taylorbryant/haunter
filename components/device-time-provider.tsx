"use client";

import { useRouter } from "next/navigation";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import {
	DEVICE_TIMEZONE_COOKIE_MAX_AGE,
	DEVICE_TIMEZONE_COOKIE_NAME,
	type DeviceTimeState,
	deviceTimeAt,
	getBrowserTimezone,
} from "@/lib/device-timezone";

const DeviceTimeContext = createContext<DeviceTimeState | null>(null);

function readCookie(name: string): string | null {
	const prefix = `${name}=`;
	const cookie = document.cookie
		.split("; ")
		.find((item) => item.startsWith(prefix));
	return cookie?.slice(prefix.length) ?? null;
}

function sameDeviceTime(
	left: DeviceTimeState,
	right: DeviceTimeState,
): boolean {
	return (
		left.ready === right.ready &&
		left.timezone === right.timezone &&
		left.today === right.today &&
		left.currentTime === right.currentTime
	);
}

export function DeviceTimeProvider({
	initialValue,
	children,
}: {
	initialValue: DeviceTimeState;
	children: ReactNode;
}) {
	const router = useRouter();
	const [value, setValue] = useState(initialValue);

	useEffect(() => {
		function synchronizeDeviceTime() {
			const timezone = getBrowserTimezone();
			if (!timezone) return;

			const next = deviceTimeAt(new Date(), timezone);
			setValue((current) => (sameDeviceTime(current, next) ? current : next));

			const encodedTimezone = encodeURIComponent(timezone);
			if (readCookie(DEVICE_TIMEZONE_COOKIE_NAME) === encodedTimezone) return;

			// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not available in every supported browser
			document.cookie = `${DEVICE_TIMEZONE_COOKIE_NAME}=${encodedTimezone}; path=/; max-age=${DEVICE_TIMEZONE_COOKIE_MAX_AGE}; samesite=lax`;
			router.refresh();
		}

		function synchronizeWhenVisible() {
			if (document.visibilityState === "visible") synchronizeDeviceTime();
		}

		synchronizeDeviceTime();
		const timer = window.setInterval(synchronizeDeviceTime, 60_000);
		window.addEventListener("focus", synchronizeDeviceTime);
		document.addEventListener("visibilitychange", synchronizeWhenVisible);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", synchronizeDeviceTime);
			document.removeEventListener("visibilitychange", synchronizeWhenVisible);
		};
	}, [router]);

	return (
		<DeviceTimeContext.Provider value={value}>
			{children}
		</DeviceTimeContext.Provider>
	);
}

export function useDeviceTime(): DeviceTimeState {
	const value = useContext(DeviceTimeContext);
	if (!value) {
		throw new Error("useDeviceTime must be used inside DeviceTimeProvider");
	}
	return value;
}

/**
 * Read the shared app clock when available, or take a browser-local snapshot
 * for client-only surfaces such as public shared pages.
 */
export function useDeviceTimeOrLocalFallback(): DeviceTimeState {
	const value = useContext(DeviceTimeContext);
	if (value) return value;

	const timezone = getBrowserTimezone() ?? "UTC";
	return deviceTimeAt(new Date(), timezone);
}
