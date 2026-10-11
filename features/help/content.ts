import "@beignet/core/server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { findHelpGuide, helpHeadingId } from "./guides";

/** Only registered guides can be read; URL input never becomes a file path. */
export async function loadHelpGuide(slug: string) {
	const guide = findHelpGuide(slug);
	if (!guide) return null;
	const content = await readFile(
		path.join(process.cwd(), "content", "help", `${guide.slug}.md`),
		"utf8",
	);
	const headings = Array.from(content.matchAll(/^## (.+)$/gm), (match) => ({
		title: match[1],
		id: helpHeadingId(match[1]),
	}));
	return { ...guide, content, headings };
}
