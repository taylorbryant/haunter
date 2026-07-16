import type { ThemeRegistration } from "@shikijs/core";
import dracula from "@shikijs/themes/dracula";

const ALUCARD_SYNTAX_COLORS: Record<string, string> = {
	"#50FA7B": "#14710A",
	"#6272A4": "#6C664B",
	"#8BE9FD": "#036A96",
	"#8BE9FE": "#036A96",
	"#BD93F9": "#644AC9",
	"#E9F284": "#846E15",
	"#F1FA8C": "#846E15",
	"#F8F8F2": "#1F1F1F",
	"#FF5555": "#CB3A2A",
	"#FF79C6": "#A3144D",
	"#FFB86C": "#A34D14",
};

function toAlucardColor(color: string | undefined) {
	return color ? (ALUCARD_SYNTAX_COLORS[color.toUpperCase()] ?? color) : color;
}

const tokenColors = dracula.tokenColors?.map((rule) => ({
	...rule,
	settings: {
		...rule.settings,
		foreground: toAlucardColor(rule.settings.foreground),
		background: toAlucardColor(rule.settings.background),
	},
}));

const alucard = {
	name: "alucard",
	displayName: "Alucard",
	type: "light",
	semanticHighlighting: true,
	colors: {
		"editor.background": "#FFFBEB",
		"editor.foreground": "#1F1F1F",
		"editor.selectionBackground": "#CFCFDE",
		"editor.lineHighlightBackground": "#E2DECA",
		"editorCursor.foreground": "#644AC9",
		"editorWhitespace.foreground": "#6C664B80",
	},
	tokenColors,
} satisfies ThemeRegistration;

export default alucard;
