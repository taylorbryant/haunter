import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DocumentSessionPort } from "@/features/documents/ports";

const GrantSchema = z.object({
	kind: z.enum(["page", "canvas"]).optional(),
	userId: z.string().min(1),
	sessionId: z.string().min(1),
	workspaceId: z.string().min(1),
	pageId: z.uuid(),
	generation: z.number().int().nonnegative(),
	expiresAt: z.number().int(),
});
const signature = (secret: string, payload: string) =>
	createHmac("sha256", secret)
		.update(`haunter-document-v1:${payload}`)
		.digest();

export function createDocumentSessionTokens(
	secret: string,
): DocumentSessionPort & {
	verify(token: string): z.infer<typeof GrantSchema>;
} {
	return {
		issue(input) {
			const payload = Buffer.from(
				JSON.stringify({ ...input, expiresAt: Date.now() + 5 * 60_000 }),
			).toString("base64url");
			return {
				token: `${payload}.${signature(secret, payload).toString("base64url")}`,
			};
		},
		verify(token) {
			if (token.length > 4096) throw new Error("Invalid document session");
			const [payload, encodedSignature, extra] = token.split(".");
			if (!payload || !encodedSignature || extra)
				throw new Error("Invalid document session");
			const actual = Buffer.from(encodedSignature, "base64url");
			const expected = signature(secret, payload);
			if (
				actual.length !== expected.length ||
				!timingSafeEqual(actual, expected)
			)
				throw new Error("Invalid document session");
			const grant = GrantSchema.parse(
				JSON.parse(Buffer.from(payload, "base64url").toString()),
			);
			if (grant.expiresAt <= Date.now())
				throw new Error("Document session expired");
			return grant;
		},
	};
}
