"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useTheme } from "next-themes";
import type { BlockJson } from "@/features/pages/schemas";
import { editorSchema } from "./schema";

/**
 * Render a page document read-only, outside the app shell — used by the
 * public share view. No autosave, menus, or queries; interactive blocks that
 * need authenticated data (canvases) show their own unavailable state.
 */
export default function ReadOnlyEditor({ content }: { content: BlockJson[] }) {
	const { resolvedTheme } = useTheme();

	const editor = useCreateBlockNote({
		schema: editorSchema,
		// BlockNote rejects an empty initialContent array.
		initialContent: content.length ? (content as never) : undefined,
	});

	return (
		<div className="haunter-editor">
			<BlockNoteView
				editor={editor}
				editable={false}
				theme={resolvedTheme === "dark" ? "dark" : "light"}
				slashMenu={false}
				sideMenu={false}
			/>
		</div>
	);
}
