import { expect, test } from "bun:test";

test("release rows use the active theme interaction surface", async () => {
	const source = await Bun.file(
		new URL("../components/changelog-dialog.tsx", import.meta.url),
	).text();

	expect(source).toContain("hover:bg-accent");
	expect(source).toContain("hover:text-accent-foreground");
	expect(source).toContain("focus-visible:bg-accent");
	expect(source).toContain("group-hover:text-accent-foreground");
	expect(source).not.toContain("hover:bg-muted/40");
});
