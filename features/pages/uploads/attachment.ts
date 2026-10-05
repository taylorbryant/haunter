import { defineUpload } from "@beignet/core/uploads";
import { z } from "zod";
import type { AppContext } from "@/app-context";
import {
	ATTACHMENT_CONTENT_TYPES,
	MAX_ATTACHMENT_BYTES,
	safeAttachmentName,
} from "../attachments";
import {
	requireActiveWorkspaceId,
	requireActiveWorkspaceScope,
	requireUser,
} from "@/lib/auth";

export const AttachmentUploadMetadataSchema = z.object({
	pageId: z.string().uuid(),
});

export type AttachmentUploadMetadata = z.infer<
	typeof AttachmentUploadMetadataSchema
>;

/**
 * Private page images and documents. Reads recheck the source page and workspace.
 */
export const AttachmentUpload = defineUpload<
	"pages.attachment",
	typeof AttachmentUploadMetadataSchema,
	AppContext,
	{ urls: string[] }
>("pages.attachment", {
	metadata: AttachmentUploadMetadataSchema,
	file: {
		contentTypes: ATTACHMENT_CONTENT_TYPES,
		maxSizeBytes: MAX_ATTACHMENT_BYTES,
		maxFiles: 1,
		visibility: "private",
		// Keys embed a fresh uploadId, so objects are immutable once written.
		cacheControl: "private, max-age=31536000, immutable",
	},
	async authorize({ ctx, metadata }) {
		const scope = requireActiveWorkspaceScope(ctx);
		const page = await ctx.ports.pages.findMetaById(scope, metadata.pageId);
		if (!page || page.deletedAt !== null) return false;

		const decision = await ctx.gate.inspect("pages.update", page);
		if (decision.allowed) return true;

		return {
			allowed: false,
			reason: decision.reason ?? "You cannot attach files to this page.",
		};
	},
	key({ ctx, metadata, uploadId, file }) {
		// Keys are workspace-scoped so any member can read the attachment; the
		// read route (app/api/files) checks the caller's active workspace against
		// this segment.
		const workspaceId = requireActiveWorkspaceId(ctx);
		const extension = file.name.includes(".")
			? file.name
					.split(".")
					.pop()
					?.toLowerCase()
					.replace(/[^a-z0-9]/g, "")
			: undefined;
		const suffix = extension ? `.${extension.slice(0, 8)}` : "";
		return `pages/${workspaceId}/${metadata.pageId}/${uploadId}${suffix}`;
	},
	storageMetadata({ ctx, metadata, file }) {
		return {
			filename: safeAttachmentName(file.name),
			workspaceId: requireActiveWorkspaceId(ctx),
			userId: requireUser(ctx).id,
			pageId: metadata.pageId,
		};
	},
	async onComplete({ files }) {
		return {
			urls: files.map((file) => `/api/files/${file.key}`),
		};
	},
});
