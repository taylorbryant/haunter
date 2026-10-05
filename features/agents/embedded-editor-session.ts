import { z } from "zod";

export const EmbeddedWorkspaceAuthorizationSchema = z.object({
	workspaceId: z.string().min(1),
	challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

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
	scope: z.enum(["document", "workspace"]).optional(),
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

/** Workspace grants include their canvases; document grants retain their original boundary. */
export function canAccessEmbeddedCanvas(
	identity: Pick<
		EmbeddedEditorIdentity,
		"scope" | "workspaceId" | "pageId" | "canvasId"
	>,
	canvas: { id: string; workspaceId: string; pageId: string | null },
) {
	return (
		identity.workspaceId === canvas.workspaceId &&
		(identity.scope === "workspace" ||
			(identity.canvasId
				? identity.canvasId === canvas.id
				: !!identity.pageId && identity.pageId === canvas.pageId))
	);
}

export interface EmbeddedEditorSessionPort {
	create(input: {
		scope?: "document" | "workspace";
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
