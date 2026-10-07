import "@beignet/core/server-only";
import { z } from "zod";
import { canEditContent } from "@/lib/org-roles";
import {
	AgentFileSourceSchema,
	hasOneFileSource,
} from "@/features/agents/file-input";
import { appError } from "@/features/shared/errors";
import { assertDocumentRevision } from "@/features/documents/revision";
import { useCase } from "@/lib/use-case";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { PageEditOutputSchema, PageRevisionSchema } from "../block-editing";
import { writePageDocument } from "../lib/write-page-document";

export const AttachFileInputSchema = AgentFileSourceSchema.extend({
	pageId: z.uuid(),
	expectedRevision: PageRevisionSchema,
	caption: z.string().max(4000).default(""),
})
	.strict()
	.refine(hasOneFileSource, "Supply exactly one of file or inlineFile.");
export const AttachFileOutputSchema = PageEditOutputSchema.extend({
	blockId: z.string(),
	name: z.string(),
	mimeType: z.string(),
	size: z.number(),
});
export const attachFileUseCase = useCase
	.command("pages.attachFile")
	.input(AttachFileInputSchema)
	.output(AttachFileOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);
		const page = await ctx.ports.pages.findMetaById(scope, input.pageId);
		if (!page || page.deletedAt !== null) throw appError("PageNotFound");
		await ctx.gate.authorize("pages.update", page);
		const document = await ctx.ports.documents.find(scope, page.id);
		if (!document) throw appError("InvalidPageContent");
		assertDocumentRevision(document, input.expectedRevision);
		const file = await ctx.ports.agentFiles.read(input);
		const key = `pages/${page.workspaceId}/${page.id}/${crypto.randomUUID()}`;
		const blockId = crypto.randomUUID();
		let committed = false;
		try {
			await ctx.ports.storage.put(key, file.bytes, {
				contentType: file.mimeType,
				visibility: "private",
				cacheControl: "private, max-age=31536000, immutable",
				metadata: {
					filename: file.name,
					pageId: page.id,
					workspaceId: page.workspaceId,
					userId: user.id,
				},
			});
			const result = await writePageDocument(
				ctx,
				{ id: page.id, expectedRevision: input.expectedRevision },
				async (tx, txScope) => {
					// Downloading can take time. Recheck membership immediately before writing.
					const role = await tx.members.findRole(page.workspaceId, user.id);
					if (!role || !canEditContent(role)) throw appError("Forbidden");
					const saved = await tx.documents.appendBlocks(txScope, page.id, [
						{
							id: blockId,
							type: file.mimeType.startsWith("image/") ? "image" : "file",
							props: {
								url: `/api/files/${key}`,
								name: file.name,
								caption: input.caption,
								...(file.width
									? { previewWidth: Math.min(file.width, 800) }
									: {}),
							},
							children: [],
						},
					]);
					const current = await tx.documents.find(txScope, page.id);
					if (!current) throw appError("InvalidPageContent");
					return {
						...saved,
						generation: current.generation,
						insertedBlockIds: [blockId],
					};
				},
				() => {
					committed = true;
				},
			);
			return {
				...result,
				blockId,
				name: file.name,
				mimeType: file.mimeType,
				size: file.bytes.length,
			};
		} finally {
			if (!committed) await ctx.ports.storage.delete(key).catch(() => {});
		}
	});
