import { expect, test } from "bun:test";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import * as schema from "@/infra/db/schema";
import { checkDocumentAccess } from "@/infra/documents/access";
import {
	listenDocumentServer,
	stopDocumentServer,
} from "@/infra/documents/bun-transport";
import { createDocumentServer } from "@/infra/documents/hocuspocus";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { pageDocumentName } from "@/features/documents/model";
import {
	firstText,
	paragraph,
	seedFixtureBody,
} from "@/features/documents/tests/helpers";
import { embeddedEditorFixture } from "./embedded-editor-fixture";

async function until(condition: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + 5000;
	while (!(await condition())) {
		if (Date.now() > deadline)
			throw new Error("Timed out waiting for collaborative edit");
		await Bun.sleep(10);
	}
}

test.each(["scope", "read-only", "disconnect"] as const)(
	"accepted embedded edits remain durable after %s changes while new edits are rejected and the web editor keeps saving",
	async (change) => {
		const f = await embeddedEditorFixture();
		await seedFixtureBody(f, [paragraph("Original")]);
		const session = await f.login();
		const tokens = createDocumentSessionTokens(
			"embedded-save-test-secret-at-least-32-characters",
		);
		const health: boolean[] = [];
		const engine = createDocumentServer({
			origin: "http://localhost:3000",
			verify: tokens.verify,
			async authorize(grant) {
				return {
					ctx: f.ctx,
					role: await checkDocumentAccess(grant, f.database.db),
				};
			},
			onStorageHealth: (_name, healthy) => health.push(healthy),
		});
		// Drive the actual pending store explicitly so revocation always occurs in the debounce window.
		engine.configuration.debounce = 60_000;
		engine.configuration.maxDebounce = 60_000;
		const transport = listenDocumentServer(engine, {
			port: 0,
			hostname: "127.0.0.1",
			origin: "http://localhost:3000",
		});
		const name = pageDocumentName(f.workspaceId, f.page.id);
		const embeddedDoc = new Y.Doc(),
			webDoc = new Y.Doc();
		const embedded = new HocuspocusProvider({
			url: `ws://127.0.0.1:${transport.port}`,
			name,
			document: embeddedDoc,
			token: tokens.issue({
				...f.grant,
				sessionId: f.connection.id,
				embeddedSessionId: session.identity.id,
			}).token,
		});
		const web = new HocuspocusProvider({
			url: `ws://127.0.0.1:${transport.port}`,
			name,
			document: webDoc,
			token: tokens.issue(f.grant).token,
		});
		try {
			await until(() => embedded.isSynced && web.isSynced);
			firstText(webDoc).insert(0, "Web before. ");
			await until(() =>
				firstText(embeddedDoc).toString().includes("Web before."),
			);
			firstText(embeddedDoc).insert(0, "Accepted. ");
			await until(() => firstText(webDoc).toString().startsWith("Accepted."));
			const document = engine.documents.get(name)!;
			const embeddedConnection = document
				.getConnections()
				.find((c) => c.context.grant.embeddedSessionId);
			if (!embeddedConnection) throw new Error("Missing embedded connection");
			expect(engine.debouncer.isDebounced(`onStoreDocument-${name}`)).toBe(
				true,
			);
			if (change === "scope") {
				await f.database.db
					.update(schema.oauthConsent)
					.set({ scopes: ["openid"] });
			} else if (change === "read-only") {
				await f.database.db
					.update(schema.mcpConnection)
					.set({ embeddedEditorAccess: "view" })
					.where(eq(schema.mcpConnection.id, f.connection.id));
			} else {
				await f.ctx.ports.mcpConnections.disconnectOwned(
					f.userId,
					f.connection.id,
					new Date(),
				);
			}
			// No authorized web write is needed to rescue the already-accepted edits.
			await engine.debouncer.executeNow(`onStoreDocument-${name}`);
			expect(health).not.toContain(false);
			const stored = await f.database.repositories.documents.find(
				f.scope,
				f.page.id,
			);
			const reloaded = new Y.Doc();
			try {
				Y.applyUpdate(reloaded, stored!.state);
				expect(firstText(reloaded).toString()).toBe(
					"Accepted. Web before. Original",
				);
			} finally {
				reloaded.destroy();
			}

			firstText(embeddedDoc).insert(0, "Rejected. ");
			await until(() =>
				change === "read-only"
					? embeddedConnection.readOnly
					: !document.getConnections().includes(embeddedConnection),
			);
			// A stateless round trip on the read-only socket drains its preceding update.
			if (change === "read-only") {
				let received = false;
				embedded.on("stateless", () => {
					received = true;
				});
				embedded.sendStateless("receipt");
				await until(() => received);
			}
			expect(firstText(document).toString()).not.toContain("Rejected.");
			expect(firstText(webDoc).toString()).not.toContain("Rejected.");
			firstText(webDoc).insert(0, "Web after. ");
			await until(() =>
				firstText(document).toString().startsWith("Web after."),
			);
			await engine.debouncer.executeNow(`onStoreDocument-${name}`);
			expect(
				JSON.stringify(
					(await f.database.repositories.pages.findById(f.scope, f.page.id))
						?.content,
				),
			).toContain("Web after. Accepted. Web before. Original");
			expect(health).not.toContain(false);
		} finally {
			embedded.destroy();
			web.destroy();
			await stopDocumentServer(engine);
			await transport.stop(true);
			embeddedDoc.destroy();
			webDoc.destroy();
			await f.database.close();
		}
	},
	20_000,
);
