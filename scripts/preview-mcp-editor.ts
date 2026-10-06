import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";

// Every process uses a disposable database and synthetic account. No app env
// file credentials, production database, or email delivery are used here.
const appPort = 3097;
const hostPort = 8797;
const collaborationPort = 1397;
const appOrigin = `http://127.0.0.1:${appPort}`;
const storageRoot = await mkdtemp("/private/tmp/haunter-editor-files-");
const secret = `editor-proof-${crypto.randomUUID()}-${crypto.randomUUID()}`;
const previewEnv: Record<string, string> = {
	PATH: process.env.PATH ?? "",
	HOME: process.env.HOME ?? "",
	TMPDIR: process.env.TMPDIR ?? "/private/tmp",
	__NEXT_PROCESSED_ENV: "true",
	NODE_ENV: "development",
	APP_URL: appOrigin,
	STORAGE_ROOT: storageRoot,
	BETTER_AUTH_URL: appOrigin,
	BETTER_AUTH_SECRET: secret,
	MCP_RESOURCE_URL: `${appOrigin}/mcp`,
	MCP_EMBED_ALLOWED_ORIGINS: `http://127.0.0.1:${hostPort},http://localhost:${hostPort}`,
	NEXT_PUBLIC_COLLABORATION_URL: `ws://127.0.0.1:${collaborationPort}`,
	COLLABORATION_PORT: String(collaborationPort),
	SQLITE_DB_AUTH_TOKEN: "",
	SQLITE_DB_URL: `file:/private/tmp/haunter-editor-bootstrap-${crypto.randomUUID()}.db`,
	RESEND_API_KEY: "re_editor_proof_no_mail",
	RESEND_FROM: "Editor proof <proof@example.test>",
	DEVTOOLS_ENABLED: "false",
	LOG_LEVEL: "warn",
	REDIS_BROADCAST_URL: "",
	UPSTASH_REDIS_REST_URL: "",
	UPSTASH_REDIS_REST_TOKEN: "",
	BLOB_READ_WRITE_TOKEN: "",
	WEB_PUSH_PUBLIC_KEY: "",
	WEB_PUSH_PRIVATE_KEY: "",
};
// Omit optional empty values rather than overriding them with invalid URLs.
for (const key of [
	"REDIS_BROADCAST_URL",
	"UPSTASH_REDIS_REST_URL",
	"UPSTASH_REDIS_REST_TOKEN",
	"BLOB_READ_WRITE_TOKEN",
	"WEB_PUSH_PUBLIC_KEY",
	"WEB_PUSH_PRIVATE_KEY",
	"SQLITE_DB_AUTH_TOKEN",
])
	Reflect.deleteProperty(previewEnv, key);
for (const key of Object.keys(process.env))
	if (!(key in previewEnv)) Reflect.deleteProperty(process.env, key);
Object.assign(process.env, previewEnv);

const { createTestContextFactory } = await import("@beignet/core/testing");
const { createTenantScope } = await import("@beignet/core/ports");
const { eq } = await import("drizzle-orm");
const schema = await import("@/infra/db/schema");
const { documentFixture, paragraph, seedFixtureBody } = await import(
	"@/features/documents/tests/helpers"
);
const { createRemoteMcpRequestHandler } = await import("@/server/remote-mcp");
const { buildMcpEditorApp } = await import("./build-mcp-app");
const f = await documentFixture("owner");
const { createLocalStorage } = await import("@beignet/provider-storage-local");
f.ctx.ports.storage = createLocalStorage({ root: storageRoot });
// This fixture is shared with the Next app and collaboration worker processes.
await f.database.client.execute("PRAGMA busy_timeout = 5000");
await f.database.db
	.update(schema.organization)
	.set({ name: "Editor proof" })
	.where(eq(schema.organization.id, f.workspaceId));
await f.database.db
	.update(schema.pages)
	.set({ title: "Real editor proof", icon: "👻" })
	.where(eq(schema.pages.id, f.page.id));
await seedFixtureBody(f, [
	{
		id: "proof-heading",
		type: "heading",
		props: { level: 2 },
		content: [{ type: "text", text: "The actual Haunter editor", styles: {} }],
		children: [],
	},
	paragraph(
		"Edit this paragraph inside the panel. The same document opens in the normal web app.",
	),
	paragraph(
		"Select a passage to share it as context automatically. Close and reopen the editor to verify persistence.",
	),
]);
const secondPage = await f.database.repositories.pages.create(f.scope, {
	userId: f.userId,
	title: "Release checklist",
	parentPageId: f.page.id,
	position: 1,
});
const canvas = await f.database.repositories.canvases.create(f.scope, {
	userId: f.userId,
	pageId: secondPage.id,
	title: null,
});
await seedFixtureBody(
	{ ...f, page: secondPage },
	[
		paragraph("A second page for navigation and save verification."),
		{
			id: "rich-code",
			type: "codeBlock",
			props: { language: "javascript" },
			content: [{ type: "text", text: "const embedded = true;", styles: {} }],
			children: [],
		},
		{
			id: "rich-canvas",
			type: "canvas",
			props: { canvasId: canvas.id },
			content: undefined,
			children: [],
		},
		{
			id: "rich-link",
			type: "pageLink",
			props: { workspaceId: f.workspaceId, pageId: f.page.id },
			children: [],
		},
		{
			id: "rich-mention",
			type: "paragraph",
			props: {},
			content: [
				{
					type: "mention",
					props: { workspaceId: f.workspaceId, pageId: f.page.id },
				},
			],
			children: [],
		},
		{
			id: "rich-task",
			type: "task",
			props: { checked: false, assignee: f.userId, due: "2026-10-10" },
			content: [{ type: "text", text: "Keep the existing task", styles: {} }],
			children: [],
		},
	],
	true,
);

const assigneeId = "editor-teammate";
await f.database.db.insert(schema.user).values({
	id: assigneeId,
	name: "Alex Example",
	email: "alex@example.test",
	emailVerified: true,
	accessStatus: "approved",
	createdAt: new Date(),
	updatedAt: new Date(),
});
await f.database.db.insert(schema.member).values({
	id: "editor-teammate-membership",
	userId: assigneeId,
	organizationId: f.workspaceId,
	role: "member",
	createdAt: new Date(),
});
const secondWorkspaceId = "editor-team-workspace";
await f.database.db.insert(schema.organization).values({
	id: secondWorkspaceId,
	name: "Team workspace",
	slug: secondWorkspaceId,
	createdAt: new Date(),
});
await f.database.db.insert(schema.member).values({
	id: "editor-team-member",
	organizationId: secondWorkspaceId,
	userId: f.userId,
	role: "owner",
	createdAt: new Date(),
});
const secondScope = createTenantScope({ id: secondWorkspaceId });
const teamPage = await f.database.repositories.pages.create(secondScope, {
	userId: f.userId,
	title: "Team notes",
	parentPageId: null,
	position: 0,
});
await seedFixtureBody({ ...f, scope: secondScope, page: teamPage }, [
	paragraph("Workspace switching uses a new scoped session."),
]);
const token = crypto.randomUUID();
await f.database.db
	.update(schema.session)
	.set({ token, expiresAt: new Date(Date.now() + 60 * 60_000) })
	.where(eq(schema.session.id, "document-session"));
const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`;
const now = new Date();
await f.database.db.insert(schema.oauthClient).values({
	id: "editor-proof-oauth",
	clientId: "editor-proof-client",
	name: "Editor proof",
	redirectUris: ["http://127.0.0.1:8797/callback"],
});
await f.database.db.insert(schema.oauthConsent).values({
	id: "editor-proof-consent",
	clientId: "editor-proof-client",
	userId: f.userId,
	scopes: ["haunter:mcp"],
	createdAt: now,
	updatedAt: now,
});
const connection = await f.ctx.ports.mcpConnections.authorize({
	id: crypto.randomUUID(),
	userId: f.userId,
	clientId: "editor-proof-client",
	permissionProfile: "edit",
	embeddedEditorAccess: "edit",
	workspaceIds: [f.workspaceId, secondWorkspaceId],
	now,
});
if (!connection) throw new Error("Failed to create synthetic MCP connection");
f.ctx.ports.workspaceEventStreamLeases = {
	isConfigured: () => false,
	acquire: async () => null,
};
const makeContext = createTestContextFactory<typeof f.ctx, typeof f.ctx.ports>({
	ports: f.ctx.ports,
	actor: f.ctx.actor,
	auth: f.ctx.auth,
	extra: { membership: f.ctx.membership },
});
const mcp = createRemoteMcpRequestHandler({
	connection,
	identity: { userId: f.userId, clientId: connection.clientId },
	getServer: async () => ({
		ports: f.ctx.ports,
		createServiceContext: async (options) =>
			makeContext({ tenant: { id: options?.tenantId ?? f.workspaceId } }),
	}),
});
const html = await buildMcpEditorApp();
const hostTemplate = await Bun.file(
	new URL("../features/agents/tests/mcp-editor-host.html", import.meta.url),
).text();
const host = hostTemplate.replace(
	"<!-- page -->",
	`<script>window.editorProofPage=${JSON.stringify({ workspaceId: f.workspaceId, pageId: f.page.id })};window.editorProofWeb=${JSON.stringify(`${appOrigin}/w/${f.workspaceId}/p/${f.page.id}`)};</script>`,
);
const children: Bun.Subprocess[] = [];
const childEnv = { ...previewEnv, SQLITE_DB_URL: `file:${f.database.path}` };
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: hostPort,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/mcp" && request.method === "POST")
			return mcp(request);
		if (url.pathname === "/")
			return new Response(host, {
				headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
			});
		if (url.pathname === "/editor")
			return new Response(
				html.replaceAll("__HAUNTER_APP_ORIGIN__", appOrigin),
				{
					headers: {
						"Content-Type": "text/html",
						"Cache-Control": "no-store",
						"Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src ${appOrigin}; connect-src 'none'`,
					},
				},
			);
		if (url.pathname === "/login")
			return new Response(null, {
				status: 303,
				headers: {
					"Set-Cookie": cookie,
					Location: `http://127.0.0.1:${hostPort}/`,
				},
			});
		if (url.pathname === "/fixture")
			return Response.json({
				appOrigin,
				userId: f.userId,
				assigneeId,
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				secondPageId: secondPage.id,
				canvasId: canvas.id,
				secondWorkspaceId,
				webUrl: `${appOrigin}/w/${f.workspaceId}/p/${f.page.id}`,
			});
		if (url.pathname === "/saved")
			return Response.json(
				await f.ctx.ports.pages.findById(f.scope, f.page.id),
			);
		// Verification controls exist only in this disposable local host.
		if (url.pathname === "/test/checkpoint" && request.method === "POST") {
			const { pageId } = (await request.json()) as { pageId: string };
			const page = await f.ctx.ports.pages.findById(f.scope, pageId);
			if (!page) return new Response("Not found", { status: 404 });
			return Response.json(
				await f.ctx.ports.pageVersions.create(f.scope, {
					pageId,
					title: page.title,
					icon: page.icon,
					contentJson: JSON.stringify(page.content),
					cause: "checkpoint",
					createdBy: f.userId,
				}),
			);
		}
		if (url.pathname === "/test/access" && request.method === "POST") {
			const { mode } = (await request.json()) as { mode?: string };
			if (mode === "revoke") {
				await f.ctx.ports.mcpConnections.disconnectOwned(
					f.userId,
					connection.id,
					new Date(),
				);
			} else if (mode === "view" || mode === "edit") {
				await f.database.db
					.update(schema.mcpConnection)
					.set({ embeddedEditorAccess: mode })
					.where(eq(schema.mcpConnection.id, connection.id));
			} else {
				return new Response("Invalid test mode", { status: 400 });
			}
			return new Response(null, { status: 204 });
		}
		return new Response("Not found", { status: 404 });
	},
});
let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	server.stop(true);
	for (const child of children) child.kill("SIGTERM");
	await Promise.all(children.map((child) => child.exited));
	await f.database.close();
	await rm(storageRoot, { recursive: true, force: true });
	process.exit(0);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
children.push(
	Bun.spawn(["bun", "--no-env-file", "server/workers/collaboration.ts"], {
		env: childEnv,
		stdout: "inherit",
		stderr: "inherit",
	}),
);
children.push(
	Bun.spawn(
		[
			"node",
			"node_modules/next/dist/bin/next",
			"dev",
			"--hostname",
			"127.0.0.1",
			"--port",
			String(appPort),
		],
		{ env: childEnv, stdout: "inherit", stderr: "inherit" },
	),
);
console.log(`Real-editor proof: http://127.0.0.1:${hostPort}/`);
console.log(`Synthetic sign-in: http://127.0.0.1:${hostPort}/login`);
console.log(`Cookie-free embedded editor: http://localhost:${hostPort}/`);

for (const child of children)
	void child.exited.then((code) => {
		if (code !== 0 && !stopping) {
			console.error(
				"Preview child stopped; shutting down the disposable proof.",
			);
			void stop();
		}
	});
