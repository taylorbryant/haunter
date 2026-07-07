import { codeBlockOptions } from "@blocknote/code-block";
import {
	BlockNoteSchema,
	createCodeBlockSpec,
	createHeadingBlockSpec,
	defaultBlockSpecs,
	defaultInlineContentSpecs,
} from "@blocknote/core";
import { calloutBlockSpec } from "./callout-block";
import { canvasBlockSpec } from "./canvas-block";
import { getHaunterHighlighter } from "./code-theme";
import { dividerBlockSpec } from "./divider-block";
import { mentionSpec } from "./mention";
import { pageLinkBlockSpec } from "./page-link-block";
import { taskBlockSpec } from "./task-block";

/**
 * Languages offered in the code-block picker. The shiki bundle ships many
 * more; keep this list tight to bound the highlighter payload.
 */
const LANGUAGES = [
	"text",
	"typescript",
	"javascript",
	"tsx",
	"python",
	"sql",
	"shellscript",
	"json",
	"yaml",
	"markdown",
] as const;

export const supportedLanguages = Object.fromEntries(
	Object.entries(codeBlockOptions.supportedLanguages).filter(([id]) =>
		(LANGUAGES as readonly string[]).includes(id),
	),
);

// Haunter's task block replaces the built-in check list so the app has
// exactly one checkbox concept (task rows are reconciled from these blocks).
const {
	checkListItem: _checkListItem,
	heading: _heading,
	...baseBlockSpecs
} = defaultBlockSpecs;

const headingBlockSpec = createHeadingBlockSpec({
	levels: [1, 2, 3, 4],
});

const baseCodeBlockSpec = createCodeBlockSpec({
	...codeBlockOptions,
	defaultLanguage: "sql",
	supportedLanguages,
	// Shared app highlighter, created with the user's chosen theme.
	createHighlighter: () => getHaunterHighlighter(),
});

// Mobile keyboards capitalize, autocorrect, and spellcheck inside code
// blocks unless the DOM opts out, and BlockNote sets no input hints. They
// must be set inside the node view's render — ProseMirror treats that DOM
// as canonical, whereas attributes added from outside get reverted.
const codeBlockSpec: typeof baseCodeBlockSpec = {
	...baseCodeBlockSpec,
	implementation: {
		...baseCodeBlockSpec.implementation,
		render(
			...args: Parameters<typeof baseCodeBlockSpec.implementation.render>
		) {
			const rendered = baseCodeBlockSpec.implementation.render.apply(
				this,
				args,
			);
			if (rendered.dom instanceof HTMLElement) {
				rendered.dom.setAttribute("autocapitalize", "none");
				rendered.dom.setAttribute("autocorrect", "off");
				rendered.dom.setAttribute("spellcheck", "false");
			}
			return rendered;
		},
	},
};

/** The single extension point for Haunter's block model. */
export const editorSchema = BlockNoteSchema.create({
	blockSpecs: {
		...baseBlockSpecs,
		heading: headingBlockSpec,
		codeBlock: codeBlockSpec,
		task: taskBlockSpec(),
		canvas: canvasBlockSpec(),
		pageLink: pageLinkBlockSpec(),
		callout: calloutBlockSpec(),
		divider: dividerBlockSpec(),
	},
	inlineContentSpecs: {
		...defaultInlineContentSpecs,
		mention: mentionSpec,
	},
});

export type EditorSchema = typeof editorSchema;
