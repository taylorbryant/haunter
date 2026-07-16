import { describe, expect, test } from "bun:test";
import { APP_THEMES } from "../../../lib/themes";
import {
	getCodeTheme,
	getHaunterHighlighter,
	refreshEditorCodeHighlighting,
} from "../components/editor/code-theme";

function normalizeHex(color: string | undefined) {
	expect(color).toBeDefined();
	const value = color?.toLowerCase() ?? "";
	if (/^#[\da-f]{3}$/.test(value)) {
		return `#${value
			.slice(1)
			.split("")
			.map((digit) => digit.repeat(2))
			.join("")}`;
	}
	if (/^#[\da-f]{8}$/.test(value) && value.endsWith("ff")) {
		return value.slice(0, 7);
	}
	return value;
}

describe("code highlighting themes", () => {
	test("resolves syntax highlighting from the app theme", () => {
		expect(getCodeTheme("light").id).toBe("github-light");
		expect(getCodeTheme("alucard")).toMatchObject({
			id: "alucard",
			background: "#fffbeb",
			foreground: "#1f1f1f",
		});
		expect(getCodeTheme("rose-pine-dawn")).toMatchObject({
			id: "rose-pine-dawn",
			background: "#faf4ed",
			foreground: "#575279",
		});
		expect(getCodeTheme("catppuccin")).toMatchObject({
			id: "catppuccin-mocha",
			background: "#1e1e2e",
			foreground: "#cdd6f4",
		});
		expect(getCodeTheme("solarized").id).toBe("solarized-dark");
	});

	test("loads every palette into one dynamically themed highlighter", async () => {
		let sharedHighlighter: Awaited<
			ReturnType<typeof getHaunterHighlighter>
		> | null = null;

		for (const appTheme of APP_THEMES) {
			const highlighter = await getHaunterHighlighter(appTheme.id);
			sharedHighlighter ??= highlighter;
			expect(highlighter).toBe(sharedHighlighter);
			expect(highlighter.getLoadedThemes()).toEqual([appTheme.syntaxTheme.id]);

			if (!highlighter.getLoadedLanguages().includes("javascript")) {
				await highlighter.loadLanguage("javascript");
			}
			const tokens = highlighter.codeToTokens("const haunted = true", {
				lang: "javascript",
				theme: appTheme.syntaxTheme.id,
			});
			expect(normalizeHex(tokens.bg)).toBe(
				normalizeHex(appTheme.syntaxTheme.background),
			);
			expect(normalizeHex(tokens.fg)).toBe(
				normalizeHex(appTheme.syntaxTheme.foreground),
			);
			if (appTheme.id === "alucard") {
				const colors = tokens.tokens
					.flat()
					.map((token) => normalizeHex(token.color));
				expect(colors).toContain("#a3144d");
				expect(colors).toContain("#644ac9");
				expect(colors).not.toContain("#ff79c6");
			}
		}
	});

	test("invalidates code decorations without changing the document", () => {
		const removedPositions: number[] = [];
		const dispatchedTransactions: unknown[] = [];
		const transaction = {
			setMeta(key: string, value: boolean) {
				expect(key).toBe("prosemirror-highlight-refresh");
				expect(value).toBe(true);
				return this;
			},
		};
		const state = {
			doc: {
				descendants(
					visit: (
						node: { type: { name: string } },
						position: number,
					) => boolean | undefined,
				) {
					visit({ type: { name: "paragraph" } }, 0);
					visit({ type: { name: "codeBlock" } }, 2);
					visit({ type: { name: "codeBlock" } }, 12);
				},
			},
			plugins: [
				{
					getState: () => ({
						promises: [],
						decorations: undefined,
						cache: {
							remove: (position: number) => removedPositions.push(position),
						},
					}),
				},
			],
			tr: transaction,
		};
		const editor = {
			_tiptapEditor: {
				isDestroyed: false,
				state,
				view: {
					dispatch: (nextTransaction: unknown) =>
						dispatchedTransactions.push(nextTransaction),
				},
			},
		};

		refreshEditorCodeHighlighting(editor as never);

		expect(removedPositions).toEqual([2, 12]);
		expect(dispatchedTransactions).toEqual([transaction]);
	});
});
