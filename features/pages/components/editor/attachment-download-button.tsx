"use client";

import {
	useBlockNoteEditor,
	useComponentsContext,
	useEditorState,
} from "@blocknote/react";
import { DownloadIcon } from "lucide-react";
import { reportUserError } from "@/client/error-feedback";
import {
	attachmentKey,
	safeAttachmentName,
} from "@/features/pages/attachments";

/** A same-origin download works inside the host sandbox without opening a popup or leaking credentials. */
export function AttachmentDownloadButton() {
	const editor = useBlockNoteEditor();
	const Components = useComponentsContext();
	const block = useEditorState({
		editor,
		selector: ({ editor }) => {
			const selected = editor.getSelection()?.blocks ?? [
				editor.getTextCursorPosition().block,
			];
			const candidate = selected.length === 1 ? selected[0] : undefined;
			return candidate &&
				"url" in candidate.props &&
				typeof candidate.props.url === "string"
				? candidate
				: undefined;
		},
	});
	if (
		!Components ||
		!block ||
		!("url" in block.props) ||
		typeof block.props.url !== "string"
	)
		return null;
	const source = block.props.url;
	// External linked files retain their link in the document, without authenticated fetching.
	if (!attachmentKey(source)) return null;
	return (
		<Components.FormattingToolbar.Button
			className="bn-button"
			label="Download attachment"
			mainTooltip="Download attachment"
			icon={<DownloadIcon />}
			onClick={() => {
				void (async () => {
					const url = await editor.resolveFileUrl?.(source);
					if (!url?.startsWith("blob:"))
						throw new Error("Attachment unavailable");
					const link = document.createElement("a");
					link.href = url;
					link.download = safeAttachmentName(
						"name" in block.props && typeof block.props.name === "string"
							? block.props.name
							: "attachment",
					);
					document.body.append(link);
					link.click();
					link.remove();
				})().catch((error: unknown) =>
					reportUserError(error, "The attachment could not be downloaded."),
				);
			}}
		/>
	);
}
