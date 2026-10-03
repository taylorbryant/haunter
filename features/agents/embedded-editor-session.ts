import { z } from "zod";

export const EmbeddedEditorAuthorizationSchema = z
	.object({
		workspaceId: z.string().min(1),
		pageId: z.uuid().optional(),
		canvasId: z.uuid().optional(),
		challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	})
	.refine(
		(value) => Boolean(value.pageId) !== Boolean(value.canvasId),
		"Choose exactly one page or canvas.",
	);
export const EmbeddedEditorExchangeSchema = z.object({
	id: z.uuid(),
	proofSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const EmbeddedEditorIdentitySchema = z.object({
	id: z.uuid(),
	connectionId: z.string(),
	workspaceId: z.string(),
	pageId: z.uuid().nullable(),
	canvasId: z.uuid().optional(),
	expiresAt: z.number(),
	role: z.string(),
	user: z.object({
		id: z.string(),
		name: z.string(),
		email: z.string(),
		image: z.string().nullable(),
	}),
});
export type EmbeddedEditorIdentity = z.infer<
	typeof EmbeddedEditorIdentitySchema
>;
export const EMBEDDED_EDITOR_AUTH_SCHEME = "HaunterEmbed";

export interface EmbeddedEditorSessionPort {
	create(input: {
		connectionId: string;
		userId: string;
		workspaceId: string;
		pageId?: string;
		canvasId?: string;
		challenge: string;
		writable: boolean;
	}): Promise<{ id: string }>;
	exchange(input: z.infer<typeof EmbeddedEditorExchangeSchema>): Promise<{
		token: string;
		identity: EmbeddedEditorIdentity;
	} | null>;
	authenticate(token: string): Promise<EmbeddedEditorIdentity | null>;
	findActive(id: string): Promise<EmbeddedEditorIdentity | null>;
}
