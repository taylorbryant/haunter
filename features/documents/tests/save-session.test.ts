import { afterAll, beforeAll, expect, test } from "bun:test";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { draftRegistry } from "@/client/draft-registry";
import { appendToPageCapability } from "@/features/pages/agent-capabilities";
import { checkDocumentAccess } from "@/infra/documents/access";
import {
	listenDocumentServer,
	stopDocumentServer,
} from "@/infra/documents/bun-transport";
import { projectPageBody } from "@/infra/documents/codec";
import { createDocumentServer } from "@/infra/documents/hocuspocus";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { PageDocumentSession } from "../client/session";
import { pageDocumentName } from "../model";
import {
	documentFixture,
	firstText,
	paragraph,
	seedFixtureBody,
} from "./helpers";

const original = { ...Dexie.dependencies };
beforeAll(() => {
	Dexie.dependencies.indexedDB = indexedDB;
	Dexie.dependencies.IDBKeyRange = IDBKeyRange;
});
afterAll(() => {
	Object.assign(Dexie.dependencies, original);
});

async function until(condition: () => boolean) {
	const deadline = Date.now() + 5000;
	while (!condition()) {
		if (Date.now() > deadline)
			throw new Error("Timed out waiting for document save state");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

test.each(["before", "after"] as const)(
	"an agent append stays saved when the receipt arrives %s the update",
	async (receiptOrder) => {
		const f = await documentFixture();
		await seedFixtureBody(f, [paragraph("Original text")]);
		const tokens = createDocumentSessionTokens(
			"save-session-test-secret-at-least-32-characters",
		);
		const engine = createDocumentServer({
			origin: "http://localhost:3000",
			verify: tokens.verify,
			async authorize(grant) {
				return {
					ctx: f.ctx,
					role: await checkDocumentAccess(grant, f.database.db),
				};
			},
		});
		// Keep local edits pending until explicitly flushed, independently of polling.
		engine.configuration.debounce = 60_000;
		engine.configuration.maxDebounce = 60_000;
		const transport = listenDocumentServer(engine, {
			port: 0,
			hostname: "127.0.0.1",
			origin: "http://localhost:3000",
		});
		const session = new PageDocumentSession(
			{
				pageId: f.page.id,
				workspaceId: f.workspaceId,
				userId: f.userId,
				url: `ws://127.0.0.1:${transport.port}`,
			},
			async () => ({ ...tokens.issue(f.grant), generation: 0 }),
		);
		try {
			await session.start();
			await until(() => session.getSnapshot().saved);
			const document = engine.documents.get(
				pageDocumentName(f.workspaceId, f.page.id),
			)!;
			document.flushDelay = receiptOrder === "before" ? 50 : false;
			const append = (markdown: string) =>
				appendToPageCapability.handle({
					capability: appendToPageCapability,
					ctx: f.ctx,
					principal: { agentId: "test-agent", userId: f.userId },
					input: {
						workspaceId: f.workspaceId,
						pageId: f.page.id,
						markdown,
					},
				});
			await append("Agent appended paragraph");
			await until(
				() =>
					session.getSnapshot().revision > 0 &&
					JSON.stringify(projectPageBody(session.doc)).includes(
						"Agent appended paragraph",
					),
			);
			await session.flushLocal();
			expect(session.getSnapshot()).toMatchObject({
				saved: true,
				locallySaved: true,
				error: null,
			});
			const draft = draftRegistry
				.entries()
				.find((entry) => entry.identity.key === session.identity.key);
			expect(draft?.getSnapshot()).toMatchObject({
				status: "saved",
				dirty: false,
				locallySaved: true,
			});

			const revision = session.getSnapshot().revision;
			firstText(session.doc).insert(0, "Unsaved typing. ");
			expect(session.getSnapshot().saved).toBe(false);
			await append("Another agent paragraph");
			await until(
				() =>
					session.getSnapshot().revision > revision &&
					JSON.stringify(projectPageBody(session.doc)).includes(
						"Another agent paragraph",
					),
			);
			expect(firstText(session.doc).toString()).toBe(
				"Unsaved typing. Original text",
			);
			expect(session.getSnapshot().saved).toBe(false);
			expect(await session.flushServer()).toBe(true);

			// A deletion has no new Yjs clock entries, but still needs its own receipt.
			firstText(session.doc).delete(0, "Unsaved typing. ".length);
			expect(session.getSnapshot().saved).toBe(false);
			const savedRevision = session.getSnapshot().revision;
			await append("Agent paragraph during deletion");
			await until(
				() =>
					session.getSnapshot().revision > savedRevision &&
					JSON.stringify(projectPageBody(session.doc)).includes(
						"Agent paragraph during deletion",
					),
			);
			expect(firstText(session.doc).toString()).toBe("Original text");
			expect(session.getSnapshot().saved).toBe(false);
			expect(await session.flushServer()).toBe(true);
		} finally {
			await session.destroy(() => true);
			await stopDocumentServer(engine);
			await transport.stop(true);
			await f.database.close();
		}
	},
	15_000,
);
