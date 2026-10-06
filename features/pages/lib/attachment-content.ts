import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import { appError } from "@/features/shared/errors";
import {
	attachmentKey,
	ATTACHMENT_CONTENT_TYPES,
	safeAttachmentName,
} from "../attachments";
import type { BlockJson } from "../schemas";
import { canReadAttachment } from "./attachment-access";

function attachmentBlocks(blocks: BlockJson[]): BlockJson[] {
	return blocks.flatMap((block) => [
		...(["image", "file", "audio", "video"].includes(block.type) &&
		typeof block.props?.url === "string" &&
		block.props.url
			? [block]
			: []),
		...attachmentBlocks(block.children ?? []),
	]);
}
async function metadata(ctx: AppContext, block: BlockJson) {
	const key = attachmentKey(String(block.props?.url ?? ""));
	const object =
		key && (await canReadAttachment(ctx, key))
			? await ctx.ports.storage.stat(key)
			: null;
	return {
		blockId: block.id,
		name: safeAttachmentName(
			String(block.props?.name || object?.metadata?.filename || "attachment"),
		),
		caption: String(block.props?.caption ?? "").slice(0, 4000),
		mimeType: object?.contentType ?? null,
		size: object?.size ?? null,
		available: !!object,
	};
}
export async function listPageAttachments(
	ctx: AppContext,
	page: { pageId: string; blocks: BlockJson[] },
	offset: number,
) {
	const blocks = attachmentBlocks(page.blocks);
	const end = offset + 50;
	return {
		pageId: page.pageId,
		attachments: await Promise.all(
			blocks.slice(offset, end).map((block) => metadata(ctx, block)),
		),
		nextOffset: end < blocks.length ? end : null,
	};
}

export async function readPageAttachment(
	ctx: AppContext,
	page: { pageId: string; blocks: BlockJson[] },
	blockId: string,
) {
	const block = attachmentBlocks(page.blocks).find(
		(block) => block.id === blockId,
	);
	if (!block) throw appError("AttachmentNotFound");
	const key = attachmentKey(String(block.props?.url ?? ""));
	if (!key) throw appError("UnsupportedAttachment");
	if (!(await canReadAttachment(ctx, key)))
		throw appError("AttachmentNotFound");
	const info = await metadata(ctx, block);
	const mimeType = info.mimeType;
	if (!mimeType || !ATTACHMENT_CONTENT_TYPES.includes(mimeType))
		throw appError("UnsupportedAttachment");
	const text = mimeType.startsWith("text/") || mimeType === "application/json";
	if (!text && (info.size ?? Infinity) > 5 * 1024 * 1024)
		throw appError("UnsupportedAttachment");
	const object = await ctx.ports.storage.get(key);
	if (!object) throw appError("AttachmentNotFound");
	// Bound streamed bytes too, even when storage metadata is stale or incorrect.
	const limit = text ? 64 * 1024 : 5 * 1024 * 1024;
	const reader = object.stream().getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let truncated = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const remaining = limit - size;
			chunks.push(value.subarray(0, remaining));
			size += Math.min(value.byteLength, remaining);
			if (value.byteLength > remaining) {
				truncated = true;
				break;
			}
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	if (truncated && !text) throw appError("UnsupportedAttachment");
	const bytes = Buffer.concat(chunks);
	return {
		...info,
		pageId: page.pageId,
		truncated,
		...(text
			? { text: new TextDecoder().decode(bytes) }
			: { data: bytes.toString("base64") }),
	};
}
