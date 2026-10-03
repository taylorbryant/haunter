import { createHash } from "node:crypto";
import { createStaticAuth } from "@beignet/core/ports";
import { documentFixture } from "@/features/documents/tests/helpers";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import * as schema from "@/infra/db/schema";
import { authorizeEmbeddedEditorUseCase } from "../use-cases/authorize-embedded-editor";

const challenge = (secret: string) =>
	createHash("sha256").update(secret).digest("base64url");
export async function embeddedEditorFixture(
	access: "view" | "edit" = "edit",
	profile: "view" | "edit" = "edit",
) {
	const f = await documentFixture();
	f.ctx.ports.auth = createStaticAuth(null);
	f.ctx.ports.documentSessions = createDocumentSessionTokens(
		"embedded-test-secret",
	);
	const now = new Date();
	await f.database.db.insert(schema.oauthClient).values({
		id: "embedded-oauth",
		clientId: "embedded-client",
		name: "Embedded tests",
		redirectUris: ["https://host.test/callback"],
	});
	await f.database.db.insert(schema.oauthConsent).values({
		id: "embedded-consent",
		clientId: "embedded-client",
		userId: f.userId,
		scopes: ["haunter:mcp"],
		createdAt: now,
		updatedAt: now,
	});
	const connection = await f.ctx.ports.mcpConnections.authorize({
		id: crypto.randomUUID(),
		userId: f.userId,
		clientId: "embedded-client",
		permissionProfile: profile,
		embeddedEditorAccess: access,
		workspaceIds: [f.workspaceId],
		now,
	});
	if (!connection) throw new Error("Missing connection");
	async function handoff() {
		const proofSecret = challenge(crypto.randomUUID());
		const result = await authorizeEmbeddedEditorUseCase.run({
			ctx: f.ctx,
			input: {
				clientId: "embedded-client",
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				challenge: challenge(proofSecret),
			},
		});
		return { ...result, proofSecret };
	}
	async function login() {
		const grant = await handoff();
		const session = await f.ctx.ports.embeddedEditorSessions.exchange(grant);
		if (!session) throw new Error("Missing embedded session");
		return session;
	}
	return { ...f, connection, handoff, login };
}
