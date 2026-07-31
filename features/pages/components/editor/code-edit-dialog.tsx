"use client";

import type { BlockNoteEditor } from "@blocknote/core";
import { XIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	CODE_BLOCK_LANGUAGES,
	normalizeCodeBlockLanguage,
} from "@/features/pages/lib/code-block-language";
import { editCodeBlockIndentation } from "./code-block-indent";
import { getCodeTheme, getHaunterHighlighter } from "./code-theme";
import type { editorSchema } from "./schema";

function blockInlineText(block: { content?: unknown }): string {
	if (!Array.isArray(block.content)) return "";
	return block.content
		.map((node) => (typeof node?.text === "string" ? node.text : ""))
		.join("");
}

/** A roomier editing surface for code blocks, opened from the block header. */
export function CodeEditDialog({
	editor,
	blockId,
	editable = true,
	onClose,
}: {
	editor: BlockNoteEditor<
		(typeof editorSchema)["blockSchema"],
		(typeof editorSchema)["inlineContentSchema"],
		(typeof editorSchema)["styleSchema"]
	>;
	blockId: string;
	editable?: boolean;
	onClose: () => void;
}) {
	const { resolvedTheme } = useTheme();
	const block = editor.getBlock(blockId);
	const [text, setText] = useState(() => (block ? blockInlineText(block) : ""));
	const [language, setLanguage] = useState(() => {
		const initialLanguage =
			block?.type === "codeBlock" ? block.props.language : "text";
		return normalizeCodeBlockLanguage(initialLanguage) || "text";
	});
	const [highlightedHtml, setHighlightedHtml] = useState("");
	const overlayRef = useRef<HTMLDivElement>(null);
	const theme = getCodeTheme(resolvedTheme);

	// Re-highlight through the same shiki instance the editor uses. The
	// trailing newline keeps the overlay's last line aligned with the textarea.
	useEffect(() => {
		let live = true;
		(async () => {
			try {
				const highlighter = await getHaunterHighlighter(resolvedTheme);
				let lang = language;
				if (
					lang !== "text" &&
					!highlighter.getLoadedLanguages().includes(lang)
				) {
					await highlighter.loadLanguage(lang).catch(() => {
						lang = "text";
					});
				}
				const html = highlighter.codeToHtml(`${text}\n`, {
					lang: highlighter.getLoadedLanguages().includes(lang) ? lang : "text",
					theme: theme.id,
				});
				if (live) setHighlightedHtml(html);
			} catch {
				if (live) setHighlightedHtml("");
			}
		})();
		return () => {
			live = false;
		};
	}, [text, language, theme.id, resolvedTheme]);

	function commitAndClose() {
		if (!editable) {
			onClose();
			return;
		}
		if (editor.getBlock(blockId)) {
			editor.updateBlock(blockId, { content: text, props: { language } });
		}
		onClose();
	}

	return (
		<Dialog open onOpenChange={(open) => !open && commitAndClose()}>
			<DialogContent
				showCloseButton={false}
				className="block h-[85vh] overflow-visible p-0 sm:max-w-[90vw]"
			>
				<DialogTitle className="sr-only">
					{editable ? "Edit code" : "Code"}
				</DialogTitle>
				<div className="bn-shadcn code-edit-dialog size-full">
					<div
						data-content-type="codeBlock"
						className="bn-block-content code-edit-focus-ring relative flex h-full w-full flex-col overflow-hidden rounded-lg border"
						style={{ backgroundColor: theme.background }}
					>
						<div className="haunter-code-block-header">
							<select
								aria-label="Code language"
								value={language}
								disabled={!editable}
								onChange={(event) => setLanguage(event.target.value)}
							>
								{CODE_BLOCK_LANGUAGES.map((option) => (
									<option key={option.id} value={option.id}>
										{option.label}
									</option>
								))}
							</select>
							<DialogClose
								render={
									<button
										type="button"
										aria-label="Close code editor"
										className="haunter-code-block-expand keyboard-focus-ring"
									/>
								}
							>
								<XIcon aria-hidden="true" className="size-4" />
							</DialogClose>
						</div>
						<div className="relative order-2 min-h-0 flex-1">
							<div
								ref={overlayRef}
								aria-hidden
								className="code-edit-overlay pointer-events-none absolute inset-0 overflow-hidden p-3 font-mono text-sm leading-relaxed [&_pre]:m-0 [&_pre]:whitespace-pre [&_pre]:bg-transparent!"
								// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output over user-authored code, no external input
								dangerouslySetInnerHTML={{ __html: highlightedHtml }}
							/>
							<textarea
								autoFocus
								value={text}
								aria-label="Code"
								spellCheck={false}
								autoCapitalize="none"
								autoCorrect="off"
								readOnly={!editable}
								className="code-edit-textarea relative size-full resize-none overflow-auto whitespace-pre bg-transparent p-3 font-mono text-sm text-transparent leading-relaxed outline-none"
								style={{ caretColor: theme.foreground }}
								onChange={(event) => setText(event.target.value)}
								onScroll={(event) => {
									const overlay = overlayRef.current;
									if (overlay) {
										overlay.scrollTop = event.currentTarget.scrollTop;
										overlay.scrollLeft = event.currentTarget.scrollLeft;
									}
								}}
								onKeyDown={(event) => {
									if (editable && event.key === "Tab") {
										event.preventDefault();
										const textarea = event.currentTarget;
										const edit = editCodeBlockIndentation(
											text,
											textarea.selectionStart,
											textarea.selectionEnd,
											event.shiftKey,
										);
										setText(edit.text);
										requestAnimationFrame(() => {
											textarea.setSelectionRange(
												edit.selectionFrom,
												edit.selectionTo,
											);
										});
										return;
									}
									if (
										editable &&
										(event.metaKey || event.ctrlKey) &&
										event.key === "Enter"
									) {
										event.preventDefault();
										commitAndClose();
									}
								}}
							/>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
