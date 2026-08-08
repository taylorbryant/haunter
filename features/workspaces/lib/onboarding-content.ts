import type { BlockJson } from "@/features/content/schemas";

export type OnboardingPage = {
	title: string;
	icon: string;
	content: BlockJson[];
};

const BASE = {
	backgroundColor: "default",
	textColor: "default",
	textAlignment: "left",
};

/**
 * Example pages seeded into a new user's first workspace so they land on a
 * populated app instead of a zero state. `makeId` supplies stable block ids
 * (task blocks are keyed by id when they reconcile into My Tasks) and `today`
 * is passed in to keep this builder pure and testable.
 */
export function buildOnboardingPages(
	makeId: () => string,
	today: string,
): OnboardingPage[] {
	const text = (value: string) => ({ type: "text", text: value, styles: {} });
	const paragraph = (value: string): BlockJson => ({
		id: makeId(),
		type: "paragraph",
		props: { ...BASE },
		content: [text(value)],
		children: [],
	});
	const heading = (value: string, level: number): BlockJson => ({
		id: makeId(),
		type: "heading",
		props: { ...BASE, level },
		content: [text(value)],
		children: [],
	});
	const task = (
		value: string,
		opts: { checked?: boolean; due?: string } = {},
	): BlockJson => ({
		id: makeId(),
		type: "task",
		props: { checked: opts.checked ?? false, due: opts.due ?? "" },
		content: [text(value)],
		children: [],
	});
	const callout = (emoji: string, color: string, value: string): BlockJson => ({
		id: makeId(),
		type: "callout",
		props: { emoji, color },
		content: [text(value)],
		children: [],
	});
	const code = (language: string, value: string): BlockJson => ({
		id: makeId(),
		type: "codeBlock",
		props: { language },
		content: [text(value)],
		children: [],
	});
	const divider = (): BlockJson => ({
		id: makeId(),
		type: "divider",
		props: {},
		children: [],
	});

	return [
		{
			title: "Start here",
			icon: "👋",
			content: [
				heading("Welcome to Haunter", 2),
				paragraph(
					"This is your space for notes, tasks, code, and drawings. Try a few things below — delete this page whenever you like.",
				),
				callout(
					"💡",
					"blue",
					"Type / anywhere to insert a block: tasks, callouts, code, dividers, canvases, or a link to another page.",
				),
				heading("Starter tasks", 3),
				task("Check off a task — it shows up in Tasks"),
				task("Press / and insert a callout or a code block"),
				task("Plan your week", { due: today }),
				heading("Code and SQL", 3),
				paragraph(
					"Code blocks are syntax-highlighted; pick the language and theme from Appearance.",
				),
				code(
					"sql",
					"select title, completed\nfrom tasks\norder by created_at desc\nlimit 5;",
				),
				divider(),
				paragraph(
					"Ready to make it yours? Create a page from the sidebar, or add another workspace with the switcher up top.",
				),
			],
		},
		{
			title: "This week",
			icon: "🗓️",
			content: [
				heading("This week", 2),
				paragraph(
					"A place for the week's notes and to-dos. Rename it, or keep one page per week.",
				),
				task("Add your first to-do"),
			],
		},
	];
}
