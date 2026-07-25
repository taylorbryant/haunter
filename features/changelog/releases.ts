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
		version: "0.1.0",
		date: "2026-07-24",
		title: "A faster, more connected Haunter",
		file: "0.1.0.md",
	},
] as const satisfies readonly ChangelogReleaseManifestItem[];

export const LATEST_CHANGELOG_VERSION = CHANGELOG_RELEASES[0].version;
