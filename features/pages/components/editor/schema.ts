import {
	BlockNoteSchema,
	createCodeBlockSpec,
	defaultBlockSpecs,
	defaultInlineContentSpecs,
} from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
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
const { checkListItem: _checkListItem, ...baseBlockSpecs } = defaultBlockSpecs;

/** The single extension point for Haunter's block model. */
export const editorSchema = BlockNoteSchema.create({
	blockSpecs: {
		...baseBlockSpecs,
		codeBlock: createCodeBlockSpec({
			...codeBlockOptions,
			defaultLanguage: "sql",
			supportedLanguages,
			// Shared app highlighter, created with the user's chosen theme.
			createHighlighter: () => getHaunterHighlighter(),
		}),
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
