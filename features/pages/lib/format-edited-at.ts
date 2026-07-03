/**
 * Compact "last edited" label for the page header. A fresh edit reads
 * "Just now"; older ones read "Edited 5m ago" / "Edited 2h ago" /
 * "Edited 3d ago", falling back to a short local date after a week.
 *
 * `now` is passed in (rather than read here) so the caller controls the
 * ticking cadence and the function stays pure and testable.
 */
export function formatEditedAt(iso: string, now: number): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "Saved";

	const seconds = Math.max(0, Math.round((now - then) / 1000));
	if (seconds < 60) return "Just now";

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `Edited ${minutes}m ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `Edited ${hours}h ago`;

	const days = Math.floor(hours / 24);
	if (days < 7) return `Edited ${days}d ago`;

	const date = new Date(then);
	const sameYear = new Date(now).getFullYear() === date.getFullYear();
	const label = date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		...(sameYear ? {} : { year: "numeric" }),
	});
	return `Edited ${label}`;
}
