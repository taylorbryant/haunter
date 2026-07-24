export function formatTodayDate(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	const value = new Date(Date.UTC(year, month - 1, day, 12));
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		weekday: "long",
		month: "long",
		day: "numeric",
	}).format(value);
}
