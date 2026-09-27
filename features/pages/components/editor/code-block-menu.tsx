"use client";

import { EllipsisIcon, Trash2Icon } from "lucide-react";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type CodeBlockMenuEditor = {
	readonly isEditable: boolean;
	getBlock(id: string): { type: string } | undefined;
	removeBlocks(ids: string[]): unknown;
	focus(): void;
	onChange(callback: () => void): () => void;
};

function CodeBlockMenu({
	editor,
	blockId,
}: {
	editor: CodeBlockMenuEditor;
	blockId: string;
}) {
	const subscribe = useCallback(
		(callback: () => void) => editor.onChange(callback),
		[editor],
	);
	const editable = useSyncExternalStore(subscribe, () => editor.isEditable);
	const deleted = useRef(false);

	if (!editable) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Code block options"
				className="haunter-code-block-options keyboard-focus-ring"
				onKeyDown={(event) => event.stopPropagation()}
			>
				<EllipsisIcon aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="min-w-44"
				finalFocus={() => (deleted.current ? false : true)}
			>
				<DropdownMenuItem
					variant="destructive"
					className="min-h-11"
					onClick={() => {
						// Permissions or the block may have changed while the menu was open.
						if (
							!editor.isEditable ||
							editor.getBlock(blockId)?.type !== "codeBlock"
						) {
							return;
						}
						deleted.current = true;
						editor.removeBlocks([blockId]);
						editor.focus();
					}}
				>
					<Trash2Icon aria-hidden="true" />
					Delete code block
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Add React menu controls without replacing the native editable code DOM. */
export function mountCodeBlockMenu(
	header: HTMLElement,
	editor: CodeBlockMenuEditor,
	blockId: string,
) {
	const container = document.createElement("span");
	container.className = "haunter-code-block-menu";
	header.appendChild(container);
	const root = createRoot(container);
	root.render(<CodeBlockMenu editor={editor} blockId={blockId} />);

	return () => {
		// Node views can be destroyed during a React commit. Defer unmounting
		// this root so React can finish that commit and clean up the menu portal.
		queueMicrotask(() => root.unmount());
	};
}
