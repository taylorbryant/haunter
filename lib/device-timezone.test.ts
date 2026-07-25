import { describe, expect, it } from "bun:test";
import {
	deviceTimeAt,
	isValidDeviceTimezone,
	pendingDeviceTime,
	readDeviceTimezoneCookie,
} from "./device-timezone";

describe("device timezone", () => {
	it("represents an unresolved device clock without inventing a timezone", () => {
		expect(pendingDeviceTime(123)).toEqual({
			ready: false,
			timezone: null,
			today: null,
			currentTime: null,
			timestamp: 123,
		});
	});

	it("resolves a timestamp in the device timezone", () => {
		expect(
			deviceTimeAt(new Date("2026-07-25T02:30:00.000Z"), "America/Chicago"),
		).toEqual({
			ready: true,
			timezone: "America/Chicago",
			today: "2026-07-24",
			currentTime: "21:30",
			timestamp: 1_784_946_600_000,
		});
	});

	it("accepts valid IANA timezones", () => {
		expect(isValidDeviceTimezone("America/Chicago")).toBe(true);
		expect(isValidDeviceTimezone("UTC")).toBe(true);
	});

	it("reads encoded timezone cookies and rejects invalid values", () => {
		expect(readDeviceTimezoneCookie("America%2FChicago")).toBe(
			"America/Chicago",
		);
		expect(readDeviceTimezoneCookie("not%2Fa%2Ftimezone")).toBeNull();
		expect(readDeviceTimezoneCookie("%")).toBeNull();
		expect(readDeviceTimezoneCookie(undefined)).toBeNull();
	});
});
