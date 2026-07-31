export type ChangelogReleaseManifestItem = {
	version: string;
	date: string;
	title: string;
	file: string;
};

export type ChangelogSection = {
	title: string;
	items: string[];
};

export type ChangelogRelease = Omit<ChangelogReleaseManifestItem, "file"> & {
	sections: ChangelogSection[];
};

/**
 * Newest first. Add the Markdown file and its manifest entry in the same PR so
 * the public page, unread status, and source content advance together.
 */
export const CHANGELOG_RELEASES = [
	{
		version: "0.6.1",
		date: "2026-07-30",
		title: "A better fullscreen workspace",
		file: "0.6.1.md",
	},
	{
		version: "0.6.0",
		date: "2026-07-28",
		title: "Act on tasks from notifications",
		file: "0.6.0.md",
	},
	{
		version: "0.5.1",
		date: "2026-07-28",
		title: "A smoother editor and canvas",
		file: "0.5.1.md",
	},
	{
		version: "0.5.0",
		date: "2026-07-27",
		title: "Reminders that meet you on time",
		file: "0.5.0.md",
	},
	{
		version: "0.4.0",
		date: "2026-07-27",
		title: "Create from anywhere",
		file: "0.4.0.md",
	},
	{
		version: "0.3.1",
		date: "2026-07-25",
		title: "Know when work is assigned to you",
		file: "0.3.1.md",
	},
	{
		version: "0.3.0",
		date: "2026-07-25",
		title: "Haunter, from any MCP client",
		file: "0.3.0.md",
	},
	{
		version: "0.2.0",
		date: "2026-07-24",
		title: "A new Home for your work",
		file: "0.2.0.md",
	},
	{
		version: "0.1.0",
		date: "2026-07-24",
		title: "A faster, more connected Haunter",
		file: "0.1.0.md",
	},
	{
		version: "0.0.6",
		date: "2026-07-14",
		title: "Tasks, down to the minute",
		file: "0.0.6.md",
	},
	{
		version: "0.0.5",
		date: "2026-07-11",
		title: "Haunter for your agents",
		file: "0.0.5.md",
	},
	{
		version: "0.0.4",
		date: "2026-07-09",
		title: "Today and reminders",
		file: "0.0.4.md",
	},
	{
		version: "0.0.3",
		date: "2026-07-07",
		title: "Faster capture and editing",
		file: "0.0.3.md",
	},
	{
		version: "0.0.2",
		date: "2026-07-04",
		title: "Work together",
		file: "0.0.2.md",
	},
	{
		version: "0.0.1",
		date: "2026-07-03",
		title: "Meet Haunter",
		file: "0.0.1.md",
	},
] as const satisfies readonly ChangelogReleaseManifestItem[];

export const LATEST_CHANGELOG_VERSION = CHANGELOG_RELEASES[0].version;
