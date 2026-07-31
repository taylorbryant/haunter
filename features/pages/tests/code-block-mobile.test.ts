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
		expect(css.match(/font-size: var\(--code-edit-font-size, 14px\);/g))
			.toHaveLength(3);
	});
});
