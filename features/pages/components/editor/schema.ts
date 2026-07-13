import { codeBlockOptions } from "@blocknote/code-block";
import {
	BlockNoteSchema,
	createCodeBlockSpec,
	createExtension,
	createHeadingBlockSpec,
	defaultBlockSpecs,
	defaultInlineContentSpecs,
} from "@blocknote/core";
import {
	CODE_BLOCK_LANGUAGES,
	normalizeCodeBlockLanguage,
} from "@/features/pages/lib/code-block-language";
import { calloutBlockSpec } from "./callout-block";
import { canvasBlockSpec } from "./canvas-block";
import {
	getCodeBlockIndentPositions,
	getCodeBlockUnindentRanges,
} from "./code-block-indent";
import { OPEN_CODE_BLOCK_DIALOG_EVENT } from "./code-block-dialog-event";
import { getHaunterHighlighter } from "./code-theme";
import { dividerBlockSpec } from "./divider-block";
import { mentionSpec } from "./mention";
import { pageLinkBlockSpec } from "./page-link-block";
import { taskBlockSpec } from "./task-block";

/**
 * Languages offered in the code-block picker. The shiki bundle ships many
 * more; keep this list tight to bound the highlighter payload.
 */
const LANGUAGE_IDS = new Set<string>(CODE_BLOCK_LANGUAGES.map(({ id }) => id));

export const supportedLanguages = Object.fromEntries(
	Object.entries(codeBlockOptions.supportedLanguages).filter(([id]) =>
		LANGUAGE_IDS.has(id),
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
	allowToggleHeadings: false,
});

const headingStyles = {
	1: { fontSize: "30px", lineHeight: "1.25" },
	2: { fontSize: "24px", lineHeight: "1.3" },
	3: { fontSize: "20px", lineHeight: "1.35" },
	4: { fontSize: "18px", lineHeight: "1.4" },
} as const;

type HeadingLevel = keyof typeof headingStyles;

function applyHeadingStyles(
	element: HTMLElement | undefined,
	level: HeadingLevel,
) {
	if (!element) return;

	const style = headingStyles[level];
	element.classList.add("haunter-heading", `haunter-heading-${level}`);
	element.style.setProperty("--level", style.fontSize);
	element.style.setProperty("--prev-level", style.fontSize);
	element.style.setProperty("font-size", style.fontSize, "important");
	element.style.setProperty("line-height", style.lineHeight, "important");
	element.style.setProperty("font-weight", "700", "important");
}

function getHeadingLevel(level: unknown): HeadingLevel {
	const parsed = typeof level === "number" ? level : Number(level);
	if (parsed === 2 || parsed === 3 || parsed === 4) return parsed;
	if (parsed >= 5) return 4;
	return 1;
}

const haunterHeadingBlockSpec: typeof headingBlockSpec = {
	...headingBlockSpec,
	implementation: {
		...headingBlockSpec.implementation,
		render(...args: Parameters<typeof headingBlockSpec.implementation.render>) {
			const rendered = headingBlockSpec.implementation.render.apply(this, args);
			const level = getHeadingLevel(args[0].props.level);
			applyHeadingStyles(
				rendered.dom instanceof HTMLElement ? rendered.dom : undefined,
				level,
			);
			applyHeadingStyles(rendered.contentDOM, level);

			return rendered;
		},
	},
};

const baseCodeBlockSpec = createCodeBlockSpec({
	...codeBlockOptions,
	defaultLanguage: "sql",
	supportedLanguages,
	// Shared app highlighter, created with the user's chosen theme.
	createHighlighter: () => getHaunterHighlighter(),
});

const codeBlockUnindentExtension = createExtension({
	key: "haunter-code-block-unindent",
	runsBefore: ["code-block-keyboard-shortcuts"],
	keyboardShortcuts: {
		Tab: ({ editor }) =>
			editor.transact((transaction) => {
				const { $from, $to } = transaction.selection;
				if (
					transaction.selection.empty ||
					$from.parent.type.name !== "codeBlock" ||
					!$from.sameParent($to)
				) {
					return false;
				}

				const blockStart = $from.start();
				const positions = getCodeBlockIndentPositions(
					$from.parent.textContent,
					$from.parentOffset,
					$to.parentOffset,
				);
				for (const position of positions.reverse()) {
					transaction.insertText("  ", blockStart + position);
				}
				return true;
			}),
		"Shift-Tab": ({ editor }) =>
			editor.transact((transaction) => {
				const { $from, $to } = transaction.selection;
				if (
					$from.parent.type.name !== "codeBlock" ||
					!$from.sameParent($to)
				) {
					return false;
				}

				const blockStart = $from.start();
				const ranges = getCodeBlockUnindentRanges(
					$from.parent.textContent,
					$from.parentOffset,
					$to.parentOffset,
				);
				for (const range of ranges.reverse()) {
					transaction.delete(
						blockStart + range.from,
						blockStart + range.to,
					);
				}

				// Consume Shift+Tab even when this line has no indentation so focus
				// remains in the code block instead of moving through the page UI.
				return true;
			}),
	},
});

// Mobile keyboards capitalize, autocorrect, and spellcheck inside code
// blocks unless the DOM opts out, and BlockNote sets no input hints. They
// must be set inside the node view's render — ProseMirror treats that DOM
// as canonical, whereas attributes added from outside get reverted.
const codeBlockSpec: typeof baseCodeBlockSpec = {
	...baseCodeBlockSpec,
	extensions: [
		...(baseCodeBlockSpec.extensions ?? []),
		codeBlockUnindentExtension,
	],
	implementation: {
		...baseCodeBlockSpec.implementation,
		render(
			...args: Parameters<typeof baseCodeBlockSpec.implementation.render>
		) {
			const [block] = args;
			const rendered = baseCodeBlockSpec.implementation.render.apply(
				this,
				args,
			);

			const sourceNodes =
				rendered.dom instanceof DocumentFragment
					? Array.from(rendered.dom.childNodes)
					: Array.from(rendered.dom.children);
			const selectWrapper = sourceNodes.find(
				(node): node is HTMLElement =>
					node instanceof HTMLElement &&
					node.querySelector(":scope > select") !== null,
			);
			const languageSelect = selectWrapper?.querySelector("select");
			const normalizedLanguage = normalizeCodeBlockLanguage(
				block.props.language,
			);
			if (languageSelect && normalizedLanguage) {
				languageSelect.value = normalizedLanguage;
			}
			const pre = sourceNodes.find(
				(node): node is HTMLPreElement => node instanceof HTMLPreElement,
			);
			for (const element of [pre, rendered.contentDOM]) {
				if (!element) continue;
				element.setAttribute("autocapitalize", "none");
				element.setAttribute("autocorrect", "off");
				element.setAttribute("spellcheck", "false");
			}

			const header = selectWrapper ?? document.createElement("div");
			header.classList.add("haunter-code-block-header");
			header.contentEditable = "false";
			header.style.setProperty("display", "flex");
			header.style.setProperty("width", "100%");
			header.style.setProperty("min-height", "36px");
			header.style.setProperty("align-items", "center");
			header.style.setProperty("justify-content", "space-between");
			header.style.setProperty(
				"color",
				"var(--prosemirror-highlight, #f8f8f2)",
			);
			header.style.setProperty("gap", "8px");
			if (languageSelect) {
				languageSelect.style.setProperty("position", "static");
				languageSelect.style.setProperty("opacity", "1");
				languageSelect.style.setProperty("max-width", "min(220px, 60%)");
				languageSelect.style.setProperty("min-width", "0");
				languageSelect.style.setProperty("flex-shrink", "1");
			} else if (!selectWrapper) {
				header.appendChild(document.createElement("span"));
			}

			const expandButton = document.createElement("button");
			expandButton.type = "button";
			expandButton.className = "haunter-code-block-expand keyboard-focus-ring";
			expandButton.setAttribute("aria-label", "Expand code");
			expandButton.style.setProperty("display", "flex", "important");
			expandButton.style.setProperty("width", "28px");
			expandButton.style.setProperty("height", "28px");
			expandButton.style.setProperty("flex-shrink", "0");
			expandButton.style.setProperty("align-items", "center");
			expandButton.style.setProperty("justify-content", "center");
			expandButton.style.setProperty("margin-left", "auto");
			expandButton.style.setProperty("border", "0");
			expandButton.style.setProperty("background", "transparent");
			expandButton.style.setProperty(
				"color",
				"var(--prosemirror-highlight, #f8f8f2)",
			);
			expandButton.style.setProperty("opacity", "1");
			expandButton.style.setProperty("visibility", "visible");
			expandButton.style.setProperty("pointer-events", "auto");
			expandButton.style.setProperty("-webkit-appearance", "none");
			expandButton.style.setProperty("appearance", "none");
			expandButton.innerHTML =
				'<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path><path d="m21 3-7 7"></path><path d="m3 21 7-7"></path><path d="M9 21H3v-6"></path></svg>';
			const handleExpand = () => {
				window.dispatchEvent(
					new CustomEvent(OPEN_CODE_BLOCK_DIALOG_EVENT, {
						detail: { blockId: block.id },
					}),
				);
			};
			expandButton.addEventListener("click", handleExpand);
			header.appendChild(expandButton);

			if (pre) {
				pre.style.setProperty("order", "2");
				pre.style.setProperty("width", "100%");
				pre.style.setProperty("min-width", "0");
				pre.style.setProperty("margin", "0");
			}
			if (!selectWrapper && rendered.dom instanceof DocumentFragment) {
				rendered.dom.insertBefore(header, pre ?? null);
			}

			return {
				...rendered,
				destroy: () => {
					expandButton.removeEventListener("click", handleExpand);
					rendered.destroy?.();
				},
			};
		},
	},
};

/** The single extension point for Haunter's block model. */
export const editorSchema = BlockNoteSchema.create({
	blockSpecs: {
		...baseBlockSpecs,
		heading: haunterHeadingBlockSpec,
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
