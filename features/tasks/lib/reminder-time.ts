import type { TaskReminderCandidate } from "@/features/notifications/ports";
import { localDateAndTime } from "@/lib/timezone";

const MINUTE_MS = 60_000;
const TIMED_REMINDER_GRACE_MS = 10 * MINUTE_MS;
const zonedFormatterByTimezone = new Map<string, Intl.DateTimeFormat>();

function readZonedParts(at: Date, timezone: string) {
	let formatter = zonedFormatterByTimezone.get(timezone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
		zonedFormatterByTimezone.set(timezone, formatter);
	}
	const parts = formatter.formatToParts(at);
	const read = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((part) => part.type === type)?.value ?? "0");
	return {
		year: read("year"),
		month: read("month"),
		day: read("day"),
		hour: read("hour"),
		minute: read("minute"),
		second: read("second"),
	};
}

function timezoneOffsetMs(at: Date, timezone: string) {
	const parts = readZonedParts(at, timezone);
	const representedAsUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
	return representedAsUtc - Math.floor(at.getTime() / 1_000) * 1_000;
}

/**
 * Resolves an app-local date and time to an instant.
 *
 * Ambiguous times use the earlier occurrence. Nonexistent wall times advance
 * by the timezone transition gap (for example, 02:30 becomes 03:30 during a
 * one-hour spring-forward). Sampling the nearby offsets keeps this constant
 * time rather than searching minute by minute.
 */
export function zonedDateTimeToUtc(
	date: string,
	time: string,
	timezone: string,
): Date {
	const [year, month, day] = date.split("-").map(Number);
	const [hour, minute] = time.split(":").map(Number);
	const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
	const sampleDeltas = [
		-36 * 60 * MINUTE_MS,
		-12 * 60 * MINUTE_MS,
		0,
		12 * 60 * MINUTE_MS,
		36 * 60 * MINUTE_MS,
	];
	const offsets = new Set(
		sampleDeltas.map((delta) =>
			timezoneOffsetMs(new Date(localAsUtc + delta), timezone),
		),
	);
	const candidates = [...offsets].map((offset) => {
		const instant = new Date(localAsUtc - offset);
		const parts = readZonedParts(instant, timezone);
		const roundTrippedLocal = Date.UTC(
			parts.year,
			parts.month - 1,
			parts.day,
			parts.hour,
			parts.minute,
		);
		return { instant, roundTrippedLocal };
	});

	const exact = candidates
		.filter(({ roundTrippedLocal }) => roundTrippedLocal === localAsUtc)
		.sort((a, b) => a.instant.getTime() - b.instant.getTime());
	if (exact[0]) return exact[0].instant;

	const advanced = candidates
		.filter(({ roundTrippedLocal }) => roundTrippedLocal > localAsUtc)
		.sort(
			(a, b) =>
				a.roundTrippedLocal - b.roundTrippedLocal ||
				a.instant.getTime() - b.instant.getTime(),
		);
	if (advanced[0]) return advanced[0].instant;

	return new Date(Number.NaN);
}

function nextIsoDate(date: string) {
	const [year, month, day] = date.split("-").map(Number);
	const next = new Date(Date.UTC(year, month - 1, day + 1));
	return next.toISOString().slice(0, 10);
}

export function shouldCreateTaskReminder(
	candidate: TaskReminderCandidate,
	at: Date,
): boolean {
	const dueTime = candidate.dueTime ?? "09:00";
	const dueAt = zonedDateTimeToUtc(
		candidate.dueDate,
		dueTime,
		candidate.timezone,
	);
	const configuredAt = new Date(candidate.reminderConfiguredAt);
	if (
		!Number.isFinite(dueAt.getTime()) ||
		!Number.isFinite(configuredAt.getTime()) ||
		configuredAt.getTime() > dueAt.getTime()
	) {
		return false;
	}

	const targetAt = new Date(
		dueAt.getTime() - candidate.reminderOffsetMinutes * MINUTE_MS,
	);
	if (at.getTime() < targetAt.getTime()) return false;

	const deadlineAt = candidate.dueTime
		? new Date(dueAt.getTime() + TIMED_REMINDER_GRACE_MS)
		: zonedDateTimeToUtc(
				nextIsoDate(candidate.dueDate),
				"00:00",
				candidate.timezone,
			);
	return at.getTime() < deadlineAt.getTime();
}

export function isTaskOverdueAt(
	task: {
		dueDate: string;
		dueTime: string | null;
		timezone: string;
	},
	at: Date,
): boolean {
	const local = localDateAndTime(at, task.timezone);
	return task.dueTime
		? task.dueDate < local.date ||
				(task.dueDate === local.date && task.dueTime <= local.time)
		: local.hour >= 9 && task.dueDate < local.date;
}
