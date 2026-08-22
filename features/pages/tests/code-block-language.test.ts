import { describe, expect, test } from "bun:test";
import {
	normalizeCodeBlockLanguage,
	normalizeCodeBlockLanguages,
} from "@/features/pages/lib/code-block-language";
import type { BlockJson } from "@/features/pages/schemas";

describe("code block language normalization", () => {
	test.each([undefined, null, "", "   "])(
		"uses plain text for a blank language (%p)",
		(language) => {
			expect(normalizeCodeBlockLanguage(language)).toBe("text");
		},
	);

	test("repairs persisted code blocks without mutating the source document", () => {
		const content: BlockJson[] = [
			{
				id: "code-block",
				type: "codeBlock",
				props: { language: " " },
				content: [{ type: "text", text: "select 1", styles: {} }],
				children: [],
			},
		];

		const normalized = normalizeCodeBlockLanguages(content);

		expect(normalized).not.toBe(content);
		expect(normalized[0].props.language).toBe("text");
		expect(content[0].props.language).toBe(" ");
	});
});
