import { defineUploads } from "@beignet/core/uploads";
import { AttachmentUpload } from "./attachment";

export { AttachmentUpload } from "./attachment";

export const pageUploads = defineUploads({
	attachment: AttachmentUpload,
});
