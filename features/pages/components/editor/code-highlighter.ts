import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

/**
 * One shiki bundle for the whole app: the precompiled grammars for our
 * language allowlist plus each appearance theme's matching syntax palette.
 */
export const createHaunterHighlighter = createBundledHighlighter({
	langs: {
		typescript: () => import("@shikijs/langs-precompiled/typescript"),
		ts: () => import("@shikijs/langs-precompiled/typescript"),
		javascript: () => import("@shikijs/langs-precompiled/javascript"),
		js: () => import("@shikijs/langs-precompiled/javascript"),
		tsx: () => import("@shikijs/langs-precompiled/tsx"),
		python: () => import("@shikijs/langs-precompiled/python"),
		py: () => import("@shikijs/langs-precompiled/python"),
		sql: () => import("@shikijs/langs-precompiled/sql"),
		shellscript: () => import("@shikijs/langs-precompiled/shellscript"),
		bash: () => import("@shikijs/langs-precompiled/shellscript"),
		sh: () => import("@shikijs/langs-precompiled/shellscript"),
		zsh: () => import("@shikijs/langs-precompiled/shellscript"),
		shell: () => import("@shikijs/langs-precompiled/shellscript"),
		json: () => import("@shikijs/langs-precompiled/json"),
		yaml: () => import("@shikijs/langs-precompiled/yaml"),
		yml: () => import("@shikijs/langs-precompiled/yaml"),
		markdown: () => import("@shikijs/langs-precompiled/markdown"),
		md: () => import("@shikijs/langs-precompiled/markdown"),
		mermaid: () => import("@shikijs/langs-precompiled/mermaid"),
	},
	themes: {
		"github-light": () => import("@shikijs/themes/github-light"),
		alucard: () => import("./alucard-syntax-theme"),
		"catppuccin-latte": () => import("@shikijs/themes/catppuccin-latte"),
		"rose-pine-dawn": () => import("@shikijs/themes/rose-pine-dawn"),
		"gruvbox-light-medium": () =>
			import("@shikijs/themes/gruvbox-light-medium"),
		"everforest-light": () => import("@shikijs/themes/everforest-light"),
		"solarized-light": () => import("@shikijs/themes/solarized-light"),
		"github-dark": () => import("@shikijs/themes/github-dark"),
		dracula: () => import("@shikijs/themes/dracula"),
		"catppuccin-mocha": () => import("@shikijs/themes/catppuccin-mocha"),
		"gruvbox-dark-medium": () => import("@shikijs/themes/gruvbox-dark-medium"),
		"tokyo-night": () => import("@shikijs/themes/tokyo-night"),
		nord: () => import("@shikijs/themes/nord"),
		"rose-pine": () => import("@shikijs/themes/rose-pine"),
		"everforest-dark": () => import("@shikijs/themes/everforest-dark"),
		"solarized-dark": () => import("@shikijs/themes/solarized-dark"),
	},
	engine: () => createJavaScriptRegexEngine(),
});
