"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useTheme } from "next-themes";
import type { BlockJson } from "@/features/pages/schemas";
import { SharedPageTokenProvider } from "@/features/shares/components/shared-page-context";
import { getResolvedThemeColorScheme } from "@/lib/themes";
import { useSyncEditorCodeTheme } from "./code-theme";
import { editorSchema } from "./schema";

/**
 * Render a page document read-only, outside the app shell — used by the
 * public share view. No autosave, menus, or queries. When a share token is
 * given, embedded canvases fetch through the share-scoped public endpoints.
 */
export default function ReadOnlyEditor({
	content,
	shareToken,
}: {
	content: BlockJson[];
	shareToken?: string;
}) {
	const { resolvedTheme } = useTheme();

	const editor = useCreateBlockNote({
		schema: editorSchema,
		// BlockNote rejects an empty initialContent array.
		initialContent: content.length ? (content as never) : undefined,
	});
	useSyncEditorCodeTheme(editor, resolvedTheme);

	const view = (
		<div className="haunter-editor">
			<BlockNoteView
				editor={editor}
				editable={false}
				theme={getResolvedThemeColorScheme(resolvedTheme)}
				slashMenu={false}
				sideMenu={false}
			/>
		</div>
	);

	return shareToken ? (
		<SharedPageTokenProvider token={shareToken}>{view}</SharedPageTokenProvider>
	) : (
		view
	);
}
