import { defineUpload } from "@beignet/core/uploads";
import { z } from "zod";
import type { AppContext } from "@/app-context";
import { requireUser } from "@/lib/auth";

export const AttachmentUploadMetadataSchema = z.object({
	pageId: z.string().uuid(),
});

export type AttachmentUploadMetadata = z.infer<
	typeof AttachmentUploadMetadataSchema
>;

/**
 * Images embedded in page documents via the editor's image block. Objects
 * are private; the owner reads them back through /api/files/<key>, which
 * checks the user segment baked into the key.
 */
export const AttachmentUpload = defineUpload<
	"pages.attachment",
	typeof AttachmentUploadMetadataSchema,
	AppContext,
	{ urls: string[] }
>("pages.attachment", {
	metadata: AttachmentUploadMetadataSchema,
	file: {
		contentTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
		maxSizeBytes: 10 * 1024 * 1024,
		maxFiles: 1,
		visibility: "private",
		// Keys embed a fresh uploadId, so objects are immutable once written.
		cacheControl: "private, max-age=31536000, immutable",
	},
	async authorize({ ctx, metadata }) {
		if (ctx.actor.type !== "user" || !ctx.auth || !ctx.tenant) return false;
		const page = await ctx.ports.pages.findMetaById(metadata.pageId);
		// Any member of the page's workspace may attach to it.
		return page !== null && page.workspaceId === ctx.tenant.id;
	},
	key({ ctx, metadata, uploadId, file }) {
		const user = requireUser(ctx);
		const extension = file.name.includes(".")
			? file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")
			: undefined;
		const suffix = extension ? `.${extension.slice(0, 8)}` : "";
		return `pages/${user.id}/${metadata.pageId}/${uploadId}${suffix}`;
	},
	storageMetadata({ ctx, metadata }) {
		return {
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
