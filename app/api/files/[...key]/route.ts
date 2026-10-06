import {
	ATTACHMENT_CONTENT_TYPES,
	safeAttachmentName,
} from "@/features/pages/attachments";
import { canReadAttachment } from "@/features/pages/lib/attachment-access";
import { getServer } from "@/server";

/** Cookie and embedded sessions both pass through request context and auth hooks. */
export async function GET(
	req: Request,
	{ params }: { params: Promise<{ key: string[] }> },
) {
	const { key: segments } = await params;
	const key = segments.join("/");
	const server = await getServer();
	return server
		.rawRoute({
			name: "pageAttachment.read",
			method: "GET",
			path: "/api/files/*key",
		})
		.handle(async ({ ctx }) => {
			if (!ctx.auth?.user.id || !ctx.tenant?.id)
				return new Response(null, { status: 404 });
			const limit = await ctx.ports.rateLimit.hit({
				key: `files:${ctx.auth.user.id}`,
				limit: 600,
				windowSec: 60,
			});
			if (!limit.allowed)
				return new Response(null, {
					status: 429,
					headers: limit.retryAfterSeconds
						? { "retry-after": String(limit.retryAfterSeconds) }
						: {},
				});
			if (!(await canReadAttachment(ctx, key)))
				return new Response(null, { status: 404 });
			const object = await ctx.ports.storage.get(key);
			if (!object) return new Response(null, { status: 404 });
			const mimeType =
				object.contentType &&
				ATTACHMENT_CONTENT_TYPES.includes(object.contentType)
					? object.contentType
					: "application/octet-stream";
			const name = safeAttachmentName(
				object.metadata?.filename ?? segments.at(-1) ?? "attachment",
			);
			return new Response(object.stream(), {
				headers: {
					"content-type": mimeType,
					"content-length": String(object.size),
					"content-disposition": `${mimeType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`,
					"cache-control": "private, no-store",
					"x-content-type-options": "nosniff",
					"content-security-policy": "sandbox; default-src 'none'",
				},
			});
		})(req);
}
