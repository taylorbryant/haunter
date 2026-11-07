import "@beignet/core/server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	CHANGELOG_RELEASES,
	type ChangelogRelease,
	type ChangelogReleaseManifestItem,
	type ChangelogSection,
} from "./releases";

type Frontmatter = Pick<ChangelogRelease, "version" | "date" | "title">;

function parseFrontmatter(source: string): {
	frontmatter: Frontmatter;
	body: string;
} {
	const normalized = source.replaceAll("\r\n", "\n");
	const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) {
		throw new Error("Changelog release is missing frontmatter.");
	}

	const values = new Map<string, string>();
	for (const line of (match[1] ?? "").split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1) continue;
		values.set(
			line.slice(0, separator).trim(),
			line.slice(separator + 1).trim(),
		);
	}

	const version = values.get("version");
	const date = values.get("date");
	const title = values.get("title");
	if (!version || !date || !title) {
		throw new Error("Changelog frontmatter requires version, date, and title.");
	}

	return {
		frontmatter: { version, date, title },
		body: match[2] ?? "",
	};
}

function parseSections(body: string): ChangelogSection[] {
	const sections: ChangelogSection[] = [];
	let current: ChangelogSection | null = null;

	for (const rawLine of body.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;

		if (line.startsWith("## ")) {
			current = { title: line.slice(3).trim(), items: [] };
			sections.push(current);
			continue;
		}

		if (line.startsWith("- ") && current) {
			current.items.push(line.slice(2).trim());
			continue;
		}

		throw new Error(`Unsupported changelog line: ${line}`);
	}

	if (
		sections.length === 0 ||
		sections.some((section) => section.items.length === 0)
	) {
		throw new Error(
			"Every changelog release section must contain at least one item.",
		);
	}

	return sections;
}

export function parseChangelogRelease(
	source: string,
	manifest: ChangelogReleaseManifestItem,
): ChangelogRelease {
	const { frontmatter, body } = parseFrontmatter(source);
	if (
		frontmatter.version !== manifest.version ||
		frontmatter.date !== manifest.date ||
		frontmatter.title !== manifest.title
	) {
		throw new Error(
			`Changelog frontmatter for ${manifest.file} does not match its manifest entry.`,
		);
	}

	return {
		version: frontmatter.version,
		date: frontmatter.date,
		title: frontmatter.title,
		sections: parseSections(body),
	};
}

async function readChangelogReleases(): Promise<ChangelogRelease[]> {
	return Promise.all(
		CHANGELOG_RELEASES.map(async (release) => {
			const source = await readFile(
				path.join(process.cwd(), "content", "changelog", release.file),
				"utf8",
			);
			return parseChangelogRelease(source, release);
		}),
	);
}

let releases: Promise<ChangelogRelease[]> | undefined;

/**
 * The release files ship with the build, so a production process reads and
 * parses them once instead of on every authenticated layout render. Other
 * environments re-read so edits show up without a restart.
 */
export function loadChangelogReleases(): Promise<ChangelogRelease[]> {
	if (process.env.NODE_ENV !== "production") return readChangelogReleases();
	releases ??= readChangelogReleases().catch((error: unknown) => {
		releases = undefined;
		throw error;
	});
	return releases;
}
