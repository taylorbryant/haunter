"use client";

import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import type { HighlighterGeneric } from "@shikijs/types";
import { useSyncExternalStore } from "react";

/** Curated shiki themes offered in Appearance settings. */
export const CODE_THEMES = [
	{ id: "dracula", label: "Dracula", bg: "#282a36", fg: "#f8f8f2" },
	{ id: "github-dark", label: "GitHub Dark", bg: "#24292e", fg: "#e1e4e8" },
	{ id: "github-light", label: "GitHub Light", bg: "#ffffff", fg: "#24292e" },
	{ id: "nord", label: "Nord", bg: "#2e3440", fg: "#d8dee9" },
	{ id: "one-dark-pro", label: "One Dark Pro", bg: "#282c34", fg: "#abb2bf" },
] as const;

export type CodeThemeId = (typeof CODE_THEMES)[number]["id"];

const STORAGE_KEY = "haunter.code-theme";
const DEFAULT_THEME: CodeThemeId = "dracula";

const listeners = new Set<() => void>();

export function getCodeThemeId(): CodeThemeId {
	if (typeof window === "undefined") return DEFAULT_THEME;
	const stored = localStorage.getItem(STORAGE_KEY);
	return CODE_THEMES.some((theme) => theme.id === stored)
		? (stored as CodeThemeId)
		: DEFAULT_THEME;
}

export function getCodeTheme() {
	const id = getCodeThemeId();
	return CODE_THEMES.find((theme) => theme.id === id) ?? CODE_THEMES[0];
}

export function setCodeThemeId(id: CodeThemeId) {
	localStorage.setItem(STORAGE_KEY, id);
	resetHighlighterCaches();
	for (const listener of listeners) {
		listener();
	}
}

export function useCodeThemeId(): CodeThemeId {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getCodeThemeId,
		() => DEFAULT_THEME,
	);
}

/**
 * One shiki bundle for the whole app: the precompiled grammars for our
 * language allowlist plus the curated themes (each loaded on demand).
 */
const createHaunterHighlighter = createBundledHighlighter({
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
	},
	themes: {
		dracula: () => import("@shikijs/themes/dracula"),
		"github-dark": () => import("@shikijs/themes/github-dark"),
		"github-light": () => import("@shikijs/themes/github-light"),
		nord: () => import("@shikijs/themes/nord"),
		"one-dark-pro": () => import("@shikijs/themes/one-dark-pro"),
	},
	engine: () => createJavaScriptRegexEngine(),
});

let highlighterPromise: Promise<HighlighterGeneric<string, string>> | undefined;

/** The app-wide highlighter, created with the currently selected theme. */
export function getHaunterHighlighter() {
	highlighterPromise ??= createHaunterHighlighter({
		themes: [getCodeThemeId()],
		langs: [],
	}) as Promise<HighlighterGeneric<string, string>>;
	return highlighterPromise;
}

/**
 * Drop our cache AND BlockNote's shiki singletons so editors mounted after
 * a theme change build a fresh highlighter with the new theme.
 */
function resetHighlighterCaches() {
	highlighterPromise = undefined;
	const globals = globalThis as Record<symbol, unknown>;
	delete globals[Symbol.for("blocknote.shikiParser")];
	delete globals[Symbol.for("blocknote.shikiHighlighterPromise")];
}
