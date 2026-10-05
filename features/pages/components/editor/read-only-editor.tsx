"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { createAttachmentUrlResolver } from "@/features/pages/client/attachment-urls";
import { HistoryPreviewContext } from "./history-preview-context";
import { normalizeCodeBlockLanguages } from "@/features/pages/lib/code-block-language";
import type { BlockJson } from "@/features/pages/schemas";
import { SharedPageTokenProvider } from "@/features/shares/components/shared-page-context";
import { getResolvedThemeColorScheme } from "@/lib/themes";
import { useSyncEditorCodeTheme } from "./code-theme";
import { editorSchema, syntaxHighlightingExtension } from "./schema";

/**
 * Render a page document read-only, outside the app shell — used by the
 * public share view. No autosave, menus, or queries. When a share token is
 * given, embedded canvases fetch through the share-scoped public endpoints.
 */
export default function ReadOnlyEditor({
	content,
	shareToken,
	historyPreview = false,
}: {
	content: BlockJson[];
	shareToken?: string;
	historyPreview?: boolean;
}) {
	const { resolvedTheme } = useTheme();
	const normalizedContent = normalizeCodeBlockLanguages(content);
	const attachments = useRef<ReturnType<
		typeof createAttachmentUrlResolver
	> | null>(null);
	useEffect(
		() => () => {
			attachments.current?.dispose();
			attachments.current = null;
		},
		[],
	);

	const editor = useCreateBlockNote({
		schema: editorSchema,
		extensions: [syntaxHighlightingExtension],
		resolveFileUrl: shareToken
			? undefined
			: (url) => {
					attachments.current ??= createAttachmentUrlResolver();
					return attachments.current.resolve(url);
				},
		// BlockNote rejects an empty initialContent array.
		initialContent: normalizedContent.length
			? (normalizedContent as never)
			: undefined,
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
		<HistoryPreviewContext.Provider value={historyPreview}>
			{view}
		</HistoryPreviewContext.Provider>
	);
}
