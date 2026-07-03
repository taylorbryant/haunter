import { createUploadClient } from "@beignet/core/uploads/client";
// Type-only: the upload definition itself stays server-side.
import type { pageUploads } from "@/features/pages/uploads";

const uploadClient = createUploadClient<typeof pageUploads>();

/**
 * Upload an editor image and return the app URL that serves it back.
 * Used as BlockNote's `uploadFile` handler (file picker, paste, and drop).
 */
export async function uploadPageImage(
	pageId: string,
	file: File,
): Promise<string> {
	const completed = await uploadClient.upload("pages.attachment", {
		metadata: { pageId },
		files: [file],
	});

	const url =
		completed.result?.urls?.[0] ??
		(completed.files[0] ? `/api/files/${completed.files[0].key}` : null);
	if (!url) {
		throw new Error("Upload did not return a file URL.");
	}
	return url;
}
