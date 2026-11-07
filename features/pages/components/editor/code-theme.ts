"use client";

import type { BlockNoteEditor } from "@blocknote/core";
import type { HighlighterGeneric } from "@shikijs/types";
import { useEffect } from "react";
import {
	APP_THEME_IDS,
	getResolvedSyntaxTheme,
	type SyntaxThemeId,
} from "@/lib/themes";

type CodeThemeEditor = Pick<BlockNoteEditor, "_tiptapEditor">;

function getDocumentResolvedTheme(): string {
	if (typeof document === "undefined") return "light";

	const appTheme = APP_THEME_IDS.find((theme) =>
		document.documentElement.classList.contains(theme),
	);
	if (appTheme) return appTheme;

	return window.matchMedia?.("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function getCodeTheme(resolvedTheme?: string) {
	return getResolvedSyntaxTheme(resolvedTheme ?? getDocumentResolvedTheme());
}

let activeCodeThemeId: SyntaxThemeId = "github-light";
let activeThemeRequest = 0;
let rawHighlighter: HighlighterGeneric<string, string> | undefined;
let highlighterPromise: Promise<HighlighterGeneric<string, string>> | undefined;

function getOrCreateHighlighter(initialTheme: SyntaxThemeId) {
	// Empty documents need theme colors, but not Shiki or its regex engine.
	highlighterPromise ??= import("./code-highlighter")
		.then(({ createHaunterHighlighter }) =>
			createHaunterHighlighter({
				themes: [initialTheme],
				langs: [],
			}),
		)
		.then((createdHighlighter) => {
			rawHighlighter = createdHighlighter as HighlighterGeneric<string, string>;

			return new Proxy(rawHighlighter, {
				get(target, property) {
					if (property === "getLoadedThemes") {
						return () => [activeCodeThemeId];
					}

					const value = Reflect.get(target, property, target);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
		}) as Promise<HighlighterGeneric<string, string>>;

	return highlighterPromise;
}

/**
 * Return the shared highlighter after loading the syntax palette paired with
 * the resolved app theme. The proxy makes BlockNote's parser ask for the
 * currently active theme instead of the first theme Shiki ever loaded.
 */
export async function getHaunterHighlighter(resolvedTheme?: string) {
	const theme = getCodeTheme(resolvedTheme);
	const request = ++activeThemeRequest;
	const highlighter = await getOrCreateHighlighter(theme.id);

	if (!rawHighlighter?.getLoadedThemes().includes(theme.id)) {
		await rawHighlighter?.loadTheme(theme.id);
	}
	if (request === activeThemeRequest) {
		activeCodeThemeId = theme.id;
	}

	return highlighter;
}

type HighlightPluginState = {
	cache?: { remove: (position: number) => void };
	promises?: unknown[];
};

function isHighlightPluginState(value: unknown): value is HighlightPluginState {
	if (!value || typeof value !== "object") return false;
	const candidate = value as HighlightPluginState;
	return (
		typeof candidate.cache?.remove === "function" &&
		Array.isArray(candidate.promises) &&
		"decorations" in candidate
	);
}

/** Invalidate only code decorations, leaving editor content and history alone. */
export function refreshEditorCodeHighlighting(editor: CodeThemeEditor) {
	const tiptapEditor = editor._tiptapEditor;
	if (tiptapEditor.isDestroyed) return;

	const state = tiptapEditor.state;
	const pluginState = state.plugins
		.map((plugin) => plugin.getState(state))
		.find(isHighlightPluginState);
	if (!pluginState?.cache) return;

	let hasCodeBlocks = false;
	state.doc.descendants((node, position) => {
		if (node.type.name !== "codeBlock") return;
		hasCodeBlocks = true;
		pluginState.cache?.remove(position);
		return false;
	});
	if (!hasCodeBlocks) return;

	tiptapEditor.view.dispatch(
		state.tr.setMeta("prosemirror-highlight-refresh", true),
	);
}

/** Keep existing code blocks paired with the active appearance theme. */
export function useSyncEditorCodeTheme(
	editor: CodeThemeEditor,
	resolvedTheme: string | undefined,
) {
	useEffect(() => {
		let active = true;
		let hasCodeBlocks = false;
		editor._tiptapEditor.state.doc.descendants((node) => {
			if (node.type.name !== "codeBlock") return;
			hasCodeBlocks = true;
			return false;
		});
		if (!hasCodeBlocks) return;

		void getHaunterHighlighter(resolvedTheme)
			.then(() => {
				if (active) refreshEditorCodeHighlighting(editor);
			})
			.catch((error: unknown) => {
				console.error("Could not update code highlighting theme", error);
			});

		return () => {
			active = false;
		};
	}, [editor, resolvedTheme]);
}
