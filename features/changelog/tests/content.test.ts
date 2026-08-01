import { describe, expect, it } from "bun:test";
import {
	loadChangelogReleases,
	parseChangelogRelease,
} from "@/features/changelog/content";

const manifest = {
	version: "1.2.0",
	date: "2026-08-01",
	title: "A test release",
	file: "1.2.0.md",
};

describe("changelog content", () => {
	it("parses every checked-in release", async () => {
		const releases = await loadChangelogReleases();

		expect(releases.length).toBeGreaterThan(0);
	});

	it("parses matching release frontmatter and sections", () => {
		const release = parseChangelogRelease(
			`---
version: 1.2.0
date: 2026-08-01
title: A test release
---

## New

- First change.
- Second change.

## Fixed

- One fix.
`,
			manifest,
		);

		expect(release).toEqual({
			version: "1.2.0",
			date: "2026-08-01",
			title: "A test release",
			sections: [
				{ title: "New", items: ["First change.", "Second change."] },
				{ title: "Fixed", items: ["One fix."] },
			],
		});
	});

	it("rejects content that drifts from the release manifest", () => {
		expect(() =>
			parseChangelogRelease(
				`---
version: 1.1.0
date: 2026-08-01
title: A test release
---

## New

- A change.
`,
				manifest,
			),
		).toThrow("does not match its manifest entry");
	});

	it("rejects unsupported prose instead of silently dropping it", () => {
		expect(() =>
			parseChangelogRelease(
				`---
version: 1.2.0
date: 2026-08-01
title: A test release
---

## New

This paragraph would not be rendered.
`,
				manifest,
			),
		).toThrow("Unsupported changelog line");
	});
});
