import { describe, expect, test } from "bun:test";

describe("fullscreen code block mobile typography", () => {
	test("keeps every focused or mirrored code surface at an iOS-safe size", async () => {
		const css = await Bun.file(
			new URL("../../../app/globals.css", import.meta.url),
		).text();
		const mobileRule = css.match(
			/@media \(hover: none\) and \(pointer: coarse\) \{([\s\S]*?)\n\}/,
		)?.[1];

		expect(mobileRule).toBeDefined();
		expect(mobileRule).toContain(".code-edit-dialog");
		expect(mobileRule).toContain("--code-edit-font-size: 16px;");
		expect(css).toContain(
			".code-edit-dialog .code-edit-textarea,\n.code-edit-dialog .code-edit-overlay",
		);
		expect(
			css.match(/font-size: var\(--code-edit-font-size, 14px\);/g),
		).toHaveLength(3);
	});

	test("uses the full viewport on mobile and restores the modal on desktop", async () => {
		const source = await Bun.file(
			new URL("../components/editor/code-edit-dialog.tsx", import.meta.url),
		).text();

		expect(source).toContain(
			"top-0 left-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none",
		);
		expect(source).toContain(
			"md:top-1/2 md:left-1/2 md:h-[85dvh] md:w-[90vw] md:max-w-[90vw]",
		);
		expect(source).toContain("rounded-none border-0 md:rounded-lg md:border");
		expect(source).toContain(
			"pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2",
		);
	});
});
