"use client";

import type { BlockNoteEditor } from "@blocknote/core";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCodeTheme, getHaunterHighlighter } from "./code-theme";
import { type editorSchema, supportedLanguages } from "./schema";

function blockInlineText(block: { content?: unknown }): string {
	if (!Array.isArray(block.content)) return "";
	return block.content
		.map((node) => (typeof node?.text === "string" ? node.text : ""))
		.join("");
}

/** A roomier editing surface for code blocks, opened from the block menu. */
export function CodeEditDialog({
	editor,
	blockId,
	onClose,
}: {
	editor: BlockNoteEditor<
		(typeof editorSchema)["blockSchema"],
		(typeof editorSchema)["inlineContentSchema"],
		(typeof editorSchema)["styleSchema"]
	>;
	blockId: string;
	onClose: () => void;
}) {
	const block = editor.getBlock(blockId);
	const [text, setText] = useState(() => (block ? blockInlineText(block) : ""));
	const [language, setLanguage] = useState(() =>
		block?.type === "codeBlock" && typeof block.props.language === "string"
			? block.props.language
			: "text",
	);
	const [highlightedHtml, setHighlightedHtml] = useState("");
	const overlayRef = useRef<HTMLDivElement>(null);
	const theme = getCodeTheme();

	// Re-highlight through the same shiki instance the editor uses. The
	// trailing newline keeps the overlay's last line aligned with the textarea.
	useEffect(() => {
		let live = true;
		(async () => {
			try {
				const highlighter = await getHaunterHighlighter();
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
	}, [text, language, theme.id]);

	function save() {
		editor.updateBlock(blockId, { content: text, props: { language } });
		onClose();
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="flex h-[75vh] flex-col gap-4 sm:max-w-3xl">
				<DialogHeader>
					<div className="flex items-center gap-3">
						<DialogTitle>Edit code</DialogTitle>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={<Button variant="outline" size="sm" />}
							>
								{supportedLanguages[language]?.name ?? language}
								<ChevronDownIcon className="opacity-50" />
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="start"
								className="max-h-64 overflow-y-auto"
							>
								{Object.entries(supportedLanguages).map(([id, meta]) => (
									<DropdownMenuItem key={id} onClick={() => setLanguage(id)}>
										{meta.name}
										{id === language ? <CheckIcon className="ml-auto" /> : null}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</DialogHeader>
				<div
					className="relative min-h-0 flex-1 overflow-hidden rounded-md border"
					style={{ backgroundColor: theme.bg }}
				>
					<div
						ref={overlayRef}
						aria-hidden
						className="pointer-events-none absolute inset-0 overflow-hidden p-3 font-mono text-sm leading-relaxed [&_pre]:m-0 [&_pre]:whitespace-pre [&_pre]:bg-transparent!"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output over user-authored code, no external input
						dangerouslySetInnerHTML={{ __html: highlightedHtml }}
					/>
					<textarea
						autoFocus
						value={text}
						aria-label="Code"
						spellCheck={false}
						className="relative size-full resize-none overflow-auto whitespace-pre bg-transparent p-3 font-mono text-sm text-transparent leading-relaxed outline-none"
						style={{ caretColor: theme.fg }}
						onChange={(event) => setText(event.target.value)}
						onScroll={(event) => {
							const overlay = overlayRef.current;
							if (overlay) {
								overlay.scrollTop = event.currentTarget.scrollTop;
								overlay.scrollLeft = event.currentTarget.scrollLeft;
							}
						}}
						onKeyDown={(event) => {
							if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
								event.preventDefault();
								save();
							}
						}}
					/>
				</div>
				<DialogFooter>
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button type="button" size="sm" onClick={save}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
