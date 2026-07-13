export function localDateAndTime(at: Date, timezone: string) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(at);
	const read = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? "";
	const hour = read("hour");
	const minute = read("minute");
	return {
		date: `${read("year")}-${read("month")}-${read("day")}`,
		time: `${hour}:${minute}`,
		hour: Number(hour),
		minute: Number(minute),
	};
}

export function localDateAndHour(at: Date, timezone: string) {
	const { date, hour } = localDateAndTime(at, timezone);
	return { date, hour };
}
