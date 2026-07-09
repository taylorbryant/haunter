export function getBrowserTimezone(): string | null {
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return timezone || null;
}
