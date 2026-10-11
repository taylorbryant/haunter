import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { HelpMarkdown } from "../components/help-markdown";
import { loadHelpGuide } from "../content";
import { HELP_GUIDES } from "../guides";

test("published guides have unique destinations and every guide file is registered", async () => {
	const slugs = HELP_GUIDES.map((guide) => guide.slug);
	expect(new Set(slugs).size).toBe(slugs.length);
	const files = (await readdir("content/help"))
		.filter((file) => file.endsWith(".md") && file !== "README.md")
		.map((file) => file.slice(0, -3));
	expect(files.sort()).toEqual([...slugs].sort());
	expect(await loadHelpGuide("../../README")).toBeNull();
	expect(await loadHelpGuide("not-a-guide")).toBeNull();
});

test("all guide sections render with working anchors and internal links", async () => {
	const guides = await Promise.all(
		HELP_GUIDES.map(({ slug }) => loadHelpGuide(slug)),
	);
	for (const guide of guides) {
		expect(guide).not.toBeNull();
		if (!guide) throw new Error("Missing guide");
		const html = renderToStaticMarkup(
			<HelpMarkdown>{guide.content}</HelpMarkdown>,
		);
		expect(guide.headings.length).toBeGreaterThan(0);
		expect(new Set(guide.headings.map(({ id }) => id)).size).toBe(
			guide.headings.length,
		);
		expect(html).not.toContain("<h1");
		for (const heading of guide.headings) {
			expect(html).toContain(`<h2 id="${heading.id}">`);
		}
		for (const match of html.matchAll(/href="(\/guides[^" ]*)"/g)) {
			const url = new URL(match[1], "https://haunter.test");
			if (url.pathname === "/guides") continue;
			const target = guides.find(
				(item) => `/guides/${item?.slug}` === url.pathname,
			);
			expect(target, `${guide.slug}: ${match[1]}`).toBeDefined();
			if (url.hash) {
				expect(target?.headings.map(({ id }) => id)).toContain(
					url.hash.slice(1),
				);
			}
		}
	}
});
