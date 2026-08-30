import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHighlightPlugin } from "prosemirror-highlight";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { Decoration, EditorView } from "prosemirror-view";
import { CodeBlockCompositionHighlightingExtension } from "@/features/pages/components/editor/code-block-highlighting";
import {
	CODE_HIGHLIGHT_COMPOSITION_META,
	setEditorCodeHighlightingComposition,
} from "@/features/pages/components/editor/code-theme";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(installTestDom);
afterEach(uninstallTestDom);

function fakeHighlightingEditor({
	cursorBlockType = "codeBlock",
	includeCodeBlock = true,
}: {
	cursorBlockType?: string;
	includeCodeBlock?: boolean;
} = {}) {
	const metas: Array<[string, unknown]> = [];
	const removedPositions: number[] = [];
	const transaction = {
		setMeta(key: string, value: unknown) {
			metas.push([key, value]);
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
				if (includeCodeBlock) {
					visit({ type: { name: "codeBlock" } }, 2);
				}
			},
		},
		plugins: [
			{
				getState: () => ({
					promises: [],
					decorations: {},
					cache: {
						remove: (position: number) => removedPositions.push(position),
					},
				}),
			},
		],
		tr: transaction,
	};
	const editor = {
		getTextCursorPosition: () => ({ block: { type: cursorBlockType } }),
		_tiptapEditor: {
			isDestroyed: false,
			state,
			view: { dispatch() {} },
		},
	};

	return { editor, metas, removedPositions };
}

function createCodeSchema() {
	return new Schema({
		nodes: {
			doc: { content: "codeBlock+" },
			text: { group: "inline" },
			codeBlock: {
				content: "text*",
				group: "block",
				code: true,
				toDOM: () => ["pre", ["code", 0]],
			},
		},
	});
}

function mountCompositionExtension(
	editor: ReturnType<typeof fakeHighlightingEditor>["editor"],
	compositionTimeoutMs = 5_000,
) {
	const extension = CodeBlockCompositionHighlightingExtension({
		compositionTimeoutMs,
	})({ editor: editor as never });
	const dom = document.createElement("div");
	const controller = new AbortController();
	const cleanup = extension.mount?.({
		dom,
		root: document,
		signal: controller.signal,
	});

	return {
		dom,
		cleanup() {
			if (typeof cleanup === "function") cleanup();
			controller.abort();
		},
	};
}

function nextAnimationFrame() {
	return new Promise<void>((resolve) =>
		window.requestAnimationFrame(() => resolve()),
	);
}

async function waitForCompositionRestore() {
	await new Promise((resolve) => window.setTimeout(resolve, 25));
	await nextAnimationFrame();
}

test("freezes decorations without clearing syntax colors during composition", () => {
	const { editor, metas, removedPositions } = fakeHighlightingEditor();

	setEditorCodeHighlightingComposition(editor as never, true);

	expect(metas).toEqual([[CODE_HIGHLIGHT_COMPOSITION_META, true]]);
	expect(removedPositions).toEqual([]);
});

test("refreshes exact syntax tokens without clearing unaffected caches", () => {
	const { editor, metas, removedPositions } = fakeHighlightingEditor();

	setEditorCodeHighlightingComposition(editor as never, false);

	expect(metas).toEqual([
		[CODE_HIGHLIGHT_COMPOSITION_META, false],
		["prosemirror-highlight-refresh", true],
	]);
	expect(removedPositions).toEqual([]);
});

test("re-highlights only the code block edited during composition", () => {
	const parsedContents: string[] = [];
	const highlighter = createHighlightPlugin({
		parser: ({ content }) => {
			parsedContents.push(content);
			return [];
		},
	});
	const schema = createCodeSchema();
	let state = EditorState.create({
		schema: schema as never,
		doc: schema.node("doc", null, [
			schema.node("codeBlock", null, [schema.text("const first = 1")]),
			schema.node("codeBlock", null, [schema.text("const second = 2")]),
		]) as never,
		plugins: [highlighter],
	});

	expect(parsedContents).toEqual(["const first = 1", "const second = 2"]);
	state = state.apply(state.tr.setMeta(CODE_HIGHLIGHT_COMPOSITION_META, true));
	state = state.apply(state.tr.insertText("!", 2));
	expect(parsedContents).toHaveLength(2);
	expect(
		(highlighter.getState(state) as { compositionActive?: boolean })
			.compositionActive,
	).toBe(true);

	state = state.apply(
		state.tr
			.setMeta(CODE_HIGHLIGHT_COMPOSITION_META, false)
			.setMeta("prosemirror-highlight-refresh", true),
	);
	expect(parsedContents).toEqual([
		"const first = 1",
		"const second = 2",
		"c!onst first = 1",
	]);
	expect(
		(highlighter.getState(state) as { compositionActive?: boolean })
			.compositionActive,
	).toBe(false);
});

test("preserves highlighted composed text through document serialization", () => {
	const highlighter = createHighlightPlugin({
		parser: ({ pos }) => [
			Decoration.inline(pos + 1, pos + 6, { class: "shiki" }),
		],
	});
	const schema = createCodeSchema();
	const initialText = "const value = ";
	let state = EditorState.create({
		schema: schema as never,
		doc: schema.node("doc", null, [
			schema.node("codeBlock", null, [schema.text(initialText)]),
		]) as never,
		plugins: [highlighter],
	});
	const decorationCount = () =>
		(
			highlighter.getState(state) as {
				decorations?: { find: () => unknown[] };
			}
		).decorations?.find().length ?? 0;

	expect(decorationCount()).toBe(1);
	state = state.apply(state.tr.setMeta(CODE_HIGHLIGHT_COMPOSITION_META, true));
	for (const character of "123") {
		state = state.apply(
			state.tr.insertText(character, state.doc.textContent.length + 1),
		);
	}
	expect(state.doc.textContent).toBe("const value = 123");
	expect(decorationCount()).toBe(1);

	state = state.apply(
		state.tr
			.setMeta(CODE_HIGHLIGHT_COMPOSITION_META, false)
			.setMeta("prosemirror-highlight-refresh", true),
	);
	const persistedDocument = state.doc.toJSON();
	const restored = EditorState.create({
		schema: schema as never,
		doc: schema.nodeFromJSON(persistedDocument) as never,
		plugins: [highlighter],
	});

	expect(restored.doc.textContent).toBe("const value = 123");
	expect(
		(
			highlighter.getState(restored) as {
				decorations?: { find: () => unknown[] };
			}
		).decorations?.find(),
	).toHaveLength(1);
});

test("settles one lazy-highlighter refresh without looping during composition", async () => {
	let resolveHighlighter: (() => void) | undefined;
	let highlighterReady = false;
	let parseCount = 0;
	const pendingHighlighter = new Promise<void>((resolve) => {
		resolveHighlighter = resolve;
	});
	const highlighter = createHighlightPlugin({
		parser: () => {
			parseCount += 1;
			return highlighterReady ? [] : pendingHighlighter;
		},
	});
	const schema = createCodeSchema();
	const state = EditorState.create({
		schema: schema as never,
		doc: schema.node("doc", null, [
			schema.node("codeBlock", null, [schema.text("const value = 1")]),
		]) as never,
		plugins: [highlighter],
	});
	const host = document.createElement("div");
	document.body.append(host);
	let refreshDispatches = 0;
	let view: EditorView;
	view = new EditorView(host, {
		state: state as never,
		dispatchTransaction(transaction) {
			if (transaction.getMeta("prosemirror-highlight-refresh")) {
				refreshDispatches += 1;
			}
			view.updateState(view.state.apply(transaction));
		},
	});

	try {
		view.dispatch(view.state.tr.setMeta(CODE_HIGHLIGHT_COMPOSITION_META, true));
		highlighterReady = true;
		resolveHighlighter?.();
		for (let index = 0; index < 5; index += 1) await Promise.resolve();

		expect(refreshDispatches).toBe(1);
		expect(parseCount).toBe(1);
		expect(
			(highlighter.getState(view.state) as { promises?: unknown[] }).promises,
		).toEqual([]);

		view.dispatch(
			view.state.tr
				.setMeta(CODE_HIGHLIGHT_COMPOSITION_META, false)
				.setMeta("prosemirror-highlight-refresh", true),
		);
		expect(parseCount).toBe(2);
	} finally {
		view.destroy();
	}
});

test("subscribes once when composition ends before a lazy highlighter resolves", async () => {
	let resolveHighlighter: (() => void) | undefined;
	let highlighterReady = false;
	let parseCount = 0;
	const pendingHighlighter = new Promise<void>((resolve) => {
		resolveHighlighter = resolve;
	});
	const highlighter = createHighlightPlugin({
		parser: () => {
			parseCount += 1;
			return highlighterReady ? [] : pendingHighlighter;
		},
	});
	const schema = createCodeSchema();
	const state = EditorState.create({
		schema: schema as never,
		doc: schema.node("doc", null, [
			schema.node("codeBlock", null, [schema.text("const value = 1")]),
		]) as never,
		plugins: [highlighter],
	});
	const host = document.createElement("div");
	document.body.append(host);
	let refreshDispatches = 0;
	let view: EditorView;
	view = new EditorView(host, {
		state: state as never,
		dispatchTransaction(transaction) {
			if (transaction.getMeta("prosemirror-highlight-refresh")) {
				refreshDispatches += 1;
			}
			view.updateState(view.state.apply(transaction));
		},
	});

	try {
		view.dispatch(view.state.tr.setMeta(CODE_HIGHLIGHT_COMPOSITION_META, true));
		view.dispatch(
			view.state.tr
				.setMeta(CODE_HIGHLIGHT_COMPOSITION_META, false)
				.setMeta("prosemirror-highlight-refresh", true),
		);
		expect(parseCount).toBe(2);

		highlighterReady = true;
		resolveHighlighter?.();
		for (let index = 0; index < 5; index += 1) await Promise.resolve();

		expect(refreshDispatches).toBe(2);
		expect(parseCount).toBe(3);
	} finally {
		view.destroy();
	}
});

test("tracks native composition only when the cursor is in a code block", async () => {
	const { editor, metas } = fakeHighlightingEditor();
	const mounted = mountCompositionExtension(editor);

	mounted.dom.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true }),
	);
	expect(metas).toContainEqual([CODE_HIGHLIGHT_COMPOSITION_META, true]);

	mounted.dom.dispatchEvent(
		new CompositionEvent("compositionend", { bubbles: true }),
	);
	await waitForCompositionRestore();
	expect(metas).toContainEqual([CODE_HIGHLIGHT_COMPOSITION_META, false]);
	expect(metas).toContainEqual(["prosemirror-highlight-refresh", true]);

	mounted.cleanup();
});

test("ignores composition outside code blocks", () => {
	const { editor, metas } = fakeHighlightingEditor({
		cursorBlockType: "paragraph",
	});
	const mounted = mountCompositionExtension(editor);

	mounted.dom.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true }),
	);
	expect(metas).toEqual([]);

	mounted.cleanup();
});

test("restores highlighting when focus leaves during composition", async () => {
	const { editor, metas } = fakeHighlightingEditor();
	const mounted = mountCompositionExtension(editor);
	mounted.dom.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true }),
	);

	mounted.dom.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
	await waitForCompositionRestore();

	expect(metas).toContainEqual([CODE_HIGHLIGHT_COMPOSITION_META, false]);
	mounted.cleanup();
});

test("restores highlighting after composition inactivity", async () => {
	const { editor, metas } = fakeHighlightingEditor();
	const mounted = mountCompositionExtension(editor, 5);
	mounted.dom.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true }),
	);

	await new Promise((resolve) => window.setTimeout(resolve, 10));
	await waitForCompositionRestore();

	expect(metas).toContainEqual([CODE_HIGHLIGHT_COMPOSITION_META, false]);
	mounted.cleanup();
});

test("restores highlighting when the extension unmounts mid-composition", () => {
	const { editor, metas } = fakeHighlightingEditor();
	const mounted = mountCompositionExtension(editor);
	mounted.dom.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true }),
	);

	mounted.cleanup();

	expect(metas).toContainEqual([CODE_HIGHLIGHT_COMPOSITION_META, false]);
});
