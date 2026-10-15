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
import { loadDocumentHead } from "../client/local-store";
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

test("opening a document stays loading while real and recovered edits remain pending", async () => {
	const f = await documentFixture();
	await seedFixtureBody(f, [paragraph("Original text")]);
	const tokens = createDocumentSessionTokens(
		"initial-save-session-test-secret-at-least-32-characters",
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
	engine.configuration.debounce = 60_000;
	engine.configuration.maxDebounce = 60_000;
	const transport = listenDocumentServer(engine, {
		port: 0,
		hostname: "127.0.0.1",
		origin: "http://localhost:3000",
	});
	const options = {
		pageId: f.page.id,
		workspaceId: f.workspaceId,
		userId: f.userId,
		url: `ws://127.0.0.1:${transport.port}`,
	};
	const requestSession = async () => ({
		...tokens.issue(f.grant),
		generation: 0,
	});
	const sessions: PageDocumentSession[] = [];
	const draft = (session: PageDocumentSession) =>
		draftRegistry
			.entries()
			.find((entry) => entry.identity.key === session.identity.key)!
			.getSnapshot();
	try {
		// Neither a cold open nor loading a previously saved cache is a new save.
		for (const source of ["server", "cache"] as const) {
			const session = new PageDocumentSession(options, requestSession);
			sessions.push(session);
			const statuses: string[] = [];
			const unsubscribe = session.subscribe(() => {
				const entry = draftRegistry
					.entries()
					.find((entry) => entry.identity.key === session.identity.key);
				if (entry) statuses.push(entry.getSnapshot().status);
			});
			await session.start();
			expect(draft(session).status).toBe("loading");
			await until(
				() => session.getSnapshot().saved && session.getSnapshot().locallySaved,
			);
			expect(session.getSnapshot()).toMatchObject({
				readySource: source,
				initializing: false,
			});
			expect(draft(session).status).toBe("saved");
			expect(statuses).not.toContain("pending");
			// Receipt writes are independent of document-cache writes.
			const deadline = Date.now() + 5000;
			while (!(await loadDocumentHead(session.identity.key)).receipts?.[0]) {
				if (Date.now() > deadline) throw new Error("Receipt was not cached");
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			unsubscribe();
			await session.destroy(() => true);
		}

		// Typing before the first server acknowledgement must immediately exit loading.
		const gate =
			Promise.withResolvers<Awaited<ReturnType<typeof requestSession>>>();
		const early = new PageDocumentSession(options, () => gate.promise);
		sessions.push(early);
		await early.start();
		expect(early.getSnapshot()).toMatchObject({
			ready: true,
			initializing: true,
			saved: false,
		});
		firstText(early.doc).insert(0, "Typed while connecting. ");
		expect(draft(early)).toMatchObject({
			status: "pending",
			dirty: true,
			locallySaved: false,
		});
		gate.resolve(await requestSession());
		await until(() => early.provider?.synced === true);
		expect(await early.flushServer()).toBe(true);
		await early.destroy(() => true);

		// Offline edits remain visibly pending after a reload, before connecting.
		const offline = new PageDocumentSession(options, requestSession);
		sessions.push(offline);
		offline.pause();
		await offline.start();
		firstText(offline.doc).insert(0, "Offline edit. ");
		await offline.flushLocal();
		await offline.destroy(() => true);
		const reconnect =
			Promise.withResolvers<Awaited<ReturnType<typeof requestSession>>>();
		const recovered = new PageDocumentSession(options, () => reconnect.promise);
		sessions.push(recovered);
		await recovered.start();
		expect(draft(recovered)).toMatchObject({
			status: "pending",
			dirty: true,
			locallySaved: true,
		});
		expect(firstText(recovered.doc).toString()).toStartWith("Offline edit. ");
		reconnect.resolve(await requestSession());
		await until(() => recovered.provider?.synced === true);
		expect(await recovered.flushServer()).toBe(true);
		expect(draft(recovered).status).toBe("saved");
	} finally {
		for (const session of sessions) await session.destroy(() => true);
		await stopDocumentServer(engine);
		await transport.stop(true);
		await f.database.close();
	}
}, 15_000);

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
