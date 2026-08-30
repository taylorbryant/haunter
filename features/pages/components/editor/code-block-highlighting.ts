import { createExtension, type ExtensionOptions } from "@blocknote/core";
import { setEditorCodeHighlightingComposition } from "./code-theme";

const DEFAULT_COMPOSITION_TIMEOUT_MS = 5_000;
// ProseMirror finishes cleaning up composition nodes on a 20ms timer.
const COMPOSITION_SETTLE_DELAY_MS = 20;

type CodeBlockCompositionHighlightingOptions = {
	compositionTimeoutMs?: number;
};

/**
 * Keep BlockNote's syntax decorations visible but stable while a native IME is
 * composing inside a code block. Re-tokenizing the contenteditable DOM during
 * mobile composition can replace characters the keyboard has not committed.
 */
export const CodeBlockCompositionHighlightingExtension = createExtension(
	({
		editor,
		options,
	}: ExtensionOptions<
		CodeBlockCompositionHighlightingOptions | undefined
	>) => ({
		key: "haunter-code-block-composition-highlighting",
		mount({ dom, signal }) {
			let composingCodeBlock = false;
			let restoreFrame: number | null = null;
			let restoreDelay: number | null = null;
			let compositionTimeout: number | null = null;
			const compositionTimeoutMs =
				options?.compositionTimeoutMs ?? DEFAULT_COMPOSITION_TIMEOUT_MS;

			const clearCompositionTimeout = () => {
				if (compositionTimeout === null) return;
				window.clearTimeout(compositionTimeout);
				compositionTimeout = null;
			};
			const cancelPendingRestore = () => {
				if (restoreDelay !== null) {
					window.clearTimeout(restoreDelay);
					restoreDelay = null;
				}
				if (restoreFrame !== null) {
					window.cancelAnimationFrame(restoreFrame);
					restoreFrame = null;
				}
			};

			const restoreHighlighting = () => {
				clearCompositionTimeout();
				cancelPendingRestore();
				if (!composingCodeBlock) return;

				composingCodeBlock = false;
				setEditorCodeHighlightingComposition(editor, false);
			};

			const restoreAfterDomCommit = () => {
				clearCompositionTimeout();
				if (
					!composingCodeBlock ||
					restoreDelay !== null ||
					restoreFrame !== null
				)
					return;

				restoreDelay = window.setTimeout(() => {
					restoreDelay = null;
					restoreFrame = window.requestAnimationFrame(() => {
						restoreFrame = null;
						restoreHighlighting();
					});
				}, COMPOSITION_SETTLE_DELAY_MS);
			};

			const resetCompositionTimeout = () => {
				clearCompositionTimeout();
				compositionTimeout = window.setTimeout(
					restoreAfterDomCommit,
					compositionTimeoutMs,
				);
			};

			const handleCompositionStart = () => {
				cancelPendingRestore();
				if (composingCodeBlock) {
					resetCompositionTimeout();
					return;
				}

				try {
					if (editor.getTextCursorPosition().block.type !== "codeBlock") return;
				} catch {
					return;
				}

				composingCodeBlock = true;
				setEditorCodeHighlightingComposition(editor, true);
				resetCompositionTimeout();
			};

			const handleCompositionUpdate = () => {
				if (!composingCodeBlock) return;
				cancelPendingRestore();
				resetCompositionTimeout();
			};
			const handleCompositionEnd = restoreAfterDomCommit;

			dom.addEventListener("compositionstart", handleCompositionStart, {
				signal,
			});
			dom.addEventListener("compositionend", handleCompositionEnd, {
				signal,
			});
			dom.addEventListener("compositionupdate", handleCompositionUpdate, {
				signal,
			});
			dom.addEventListener("focusout", restoreAfterDomCommit, {
				capture: true,
				signal,
			});

			return () => {
				restoreHighlighting();
			};
		},
	}),
);

export const codeBlockCompositionHighlightingExtension =
	CodeBlockCompositionHighlightingExtension();
