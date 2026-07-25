import { localDateAndTime } from "@/lib/timezone";

export const DEVICE_TIMEZONE_COOKIE_NAME = "haunter_device_timezone";
export const DEVICE_TIMEZONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type DeviceTimeState =
	| {
			ready: false;
			timezone: null;
			today: null;
			currentTime: null;
			timestamp: number;
	  }
	| {
			ready: true;
			timezone: string;
			today: string;
			currentTime: string;
			timestamp: number;
	  };

export function pendingDeviceTime(timestamp: number): DeviceTimeState {
	return {
		ready: false,
		timezone: null,
		today: null,
		currentTime: null,
		timestamp,
	};
}

export function deviceTimeAt(
	at: Date,
	timezone: string,
): DeviceTimeState & { ready: true } {
	const local = localDateAndTime(at, timezone);
	return {
		ready: true,
		timezone,
		today: local.date,
		currentTime: local.time,
		timestamp: at.getTime(),
	};
}

export function isValidDeviceTimezone(value: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
		return true;
	} catch {
		return false;
	}
}

export function getBrowserTimezone(): string | null {
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return timezone && isValidDeviceTimezone(timezone) ? timezone : null;
}

export function readDeviceTimezoneCookie(
	value: string | undefined,
): string | null {
	if (!value) return null;
	try {
		const timezone = decodeURIComponent(value);
		return isValidDeviceTimezone(timezone) ? timezone : null;
	} catch {
		return null;
	}
}
