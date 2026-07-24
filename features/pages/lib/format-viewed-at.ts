export function formatViewedAt(viewedAt: string, now = Date.now()): string {
	const elapsed = Math.max(0, now - Date.parse(viewedAt));
	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 1) return "Viewed just now";
	if (minutes < 60) return `Viewed ${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `Viewed ${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `Viewed ${days}d ago`;
	return `Viewed ${new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
	}).format(new Date(viewedAt))}`;
}
