export function isSameOrNewerContentVersion(
	next: string,
	current: string | null,
): boolean {
	if (!current) return true;
	const nextMs = Date.parse(next);
	const currentMs = Date.parse(current);
	return Number.isNaN(nextMs) || Number.isNaN(currentMs)
		? next >= current
		: nextMs >= currentMs;
}
