import { sessionFetch } from "@/client/session-recovery";
import { createUploadClient } from "@beignet/core/uploads/client";
// Type-only: the upload definition itself stays server-side.
import type { pageUploads } from "@/features/pages/uploads";
import {
	ATTACHMENT_TYPES,
	ATTACHMENT_CONTENT_TYPES,
	MAX_ATTACHMENT_BYTES,
} from "../attachments";
import { beginPageUpload } from "./save-state";

const uploadClient = createUploadClient<typeof pageUploads>({
	fetch: sessionFetch,
});

/**
 * Upload an editor attachment and return the app URL that serves it back.
 * Used as BlockNote's `uploadFile` handler (file picker, paste, and drop).
 */
export async function uploadPageAttachment(
	pageId: string,
	file: File,
	embedded = false,
): Promise<string> {
	const type =
		file.type && file.type !== "application/octet-stream"
			? file.type
			: ATTACHMENT_TYPES[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
	if (!type || !ATTACHMENT_CONTENT_TYPES.includes(type))
		throw new Error(
			"Choose a PNG, JPEG, GIF, WebP, PDF, text, Markdown, CSV, JSON, or Office document.",
		);
	if (file.size > MAX_ATTACHMENT_BYTES)
		throw new Error("Files must be 10 MB or smaller.");
	const finish = beginPageUpload(pageId);
	try {
		const completed = await uploadClient.upload("pages.attachment", {
			metadata: { pageId },
			files: [
				file.type === type ? file : new File([file], file.name, { type }),
			],
			strategy: embedded ? "server" : "auto",
		});

		const url =
			completed.result?.urls?.[0] ??
			(completed.files[0] ? `/api/files/${completed.files[0].key}` : null);
		if (!url) {
			throw new Error("Upload did not return a file URL.");
		}
		return url;
	} finally {
		// BlockNote inserts the resulting URL after its upload promise resolves.
		// Let that document transaction run before a navigation flush proceeds.
		setTimeout(finish, 0);
	}
}
