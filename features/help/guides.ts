export const HELP_GUIDES = [
	{
		slug: "getting-started",
		title: "Getting started",
		description:
			"Find your way around and make a home for your notes, tasks, and drawings.",
	},
	{
		slug: "pages",
		title: "Writing and organizing",
		description:
			"Build connected notes with blocks, links, files, and workspace search.",
	},
	{
		slug: "tasks",
		title: "Managing tasks",
		description:
			"Keep tasks beside your notes and bring them together in one list.",
	},
	{
		slug: "canvases",
		title: "Working with canvases",
		description:
			"Sketch inside a page or start a drawing of its own, with editable templates.",
	},
	{
		slug: "ai",
		title: "Using Haunter with AI",
		description:
			"Connect an assistant, choose its access, and work together in Haunter.",
	},
	{
		slug: "sharing-and-exporting",
		title: "Sharing and exporting",
		description:
			"Work with other people, publish a page, and export your notes.",
	},
	{
		slug: "saving-and-recovery",
		title: "Saving and recovery",
		description:
			"Check save status, restore earlier versions, and recover pages and drafts.",
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
