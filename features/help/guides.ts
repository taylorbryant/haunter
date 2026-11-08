export const HELP_GUIDES = [
	{
		slug: "getting-started",
		title: "Getting started",
		description: "Set up a workspace and create your first page.",
	},
	{
		slug: "pages",
		title: "Pages and notes",
		description: "Write, organize, and find your notes.",
	},
	{
		slug: "tasks",
		title: "Tasks",
		description: "Create, assign, and schedule tasks.",
	},
	{
		slug: "canvases",
		title: "Canvases",
		description: "Draw inside a page or on a canvas of its own.",
	},
	{
		slug: "ai",
		title: "AI connections",
		description: "Connect an AI agent and choose what it can do.",
	},
	{
		slug: "sharing-and-exporting",
		title: "Sharing and export",
		description: "Invite people, share a page, or export a copy.",
	},
	{
		slug: "saving-and-recovery",
		title: "Saving and recovery",
		description: "Check saves and recover earlier or deleted work.",
	},
] as const;

export type HelpGuide = (typeof HELP_GUIDES)[number];

export function findHelpGuide(slug: string): HelpGuide | undefined {
	return HELP_GUIDES.find((guide) => guide.slug === slug);
}

export function helpHeadingId(title: string) {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}
