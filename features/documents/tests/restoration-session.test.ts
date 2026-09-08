import { seedFixtureBody } from "@/features/documents/tests/helpers";
import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import * as Y from "yjs";
import { PageDocumentSession } from "../client/session";
import {
	advanceDocumentGeneration,
	documentCacheKey,
	loadDocumentHead,
	LocalDocumentStore,
	readDocumentRecovery,
} from "../client/local-store";
import { parseRecoveryFile } from "../recovery";
import { createDocumentServer } from "@/infra/documents/hocuspocus";
import {
	listenDocumentServer,
	stopDocumentServer,
} from "@/infra/documents/bun-transport";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { checkDocumentAccess } from "@/infra/documents/access";
import { projectPageBody, seedPageBody } from "@/infra/documents/codec";
import { restorePageVersionUseCase } from "@/features/pages/use-cases/restore-page-version";
import { importRecoveryUseCase } from "../use-cases/import-recovery";
import { documentFixture, firstText, paragraph } from "./helpers";

const original = { ...Dexie.dependencies };
beforeAll(() => {
	Dexie.dependencies.indexedDB = indexedDB;
	Dexie.dependencies.IDBKeyRange = IDBKeyRange;
});
afterAll(() => {
	Object.assign(Dexie.dependencies, original);
});

async function until(condition: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + 8000;
	while (!(await condition())) {
		if (Date.now() > deadline)
			throw new Error("Timed out waiting for restoration");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

test("active and offline browser sessions switch generations, keep recoverable edits, and survive worker restart", async () => {
	const f = await documentFixture();
	await seedFixtureBody(
		f,
		JSON.parse(JSON.stringify([paragraph("Current body")])),
	);
	const version = await f.database.repositories.pageVersions.create(f.scope, {
		pageId: f.page.id,
		title: "Page",
		icon: null,
		contentJson: JSON.stringify([paragraph("Restored body")]),
		cause: "checkpoint",
		createdBy: f.userId,
	});
	const tokens = createDocumentSessionTokens(
		"restoration-session-test-secret-32-characters",
	);
	const requestSession = async () => {
		const generation =
			(await f.database.repositories.documents.getGeneration(
				f.scope,
				f.page.id,
			)) ?? 0;
		return { ...tokens.issue({ ...f.grant, generation }), generation };
	};
	const makeEngine = () =>
		createDocumentServer({
			origin: "http://localhost:3000",
			verify: tokens.verify,
			async authorize(grant) {
				return {
					ctx: f.ctx,
					role: await checkDocumentAccess(grant, f.database.db),
				};
			},
		});
	let engine = makeEngine();
	let transport = listenDocumentServer(engine, {
		origin: "http://localhost:3000",
		hostname: "127.0.0.1",
		port: 0,
	});
	const options = {
		pageId: f.page.id,
		workspaceId: f.workspaceId,
		userId: f.userId,
		url: `ws://127.0.0.1:${transport.port}`,
	};
	const left = new PageDocumentSession(options, requestSession),
		right = new PageDocumentSession(options, requestSession);
	const sessions = [left, right];
	try {
		await Promise.all(sessions.map((session) => session.start()));
		await until(() =>
			sessions.every(
				(session) => session.getSnapshot().ready && session.getSnapshot().saved,
			),
		);
		right.pause();
		await until(
			() =>
				right.provider?.configuration.websocketProvider.status ===
				"disconnected",
		);
		firstText(right.doc).insert(0, "Offline typing ");
		await right.flushLocal();
		firstText(left.doc).insert(0, "Saved before restore ");
		expect(await left.flushServer()).toBe(true);
		await restorePageVersionUseCase.run({
			ctx: f.ctx,
			input: { id: f.page.id, versionId: version.id },
		});
		await until(
			() =>
				left.getSnapshot().generation === 1 &&
				left.getSnapshot().ready &&
				left.getSnapshot().saved,
		);
		expect(firstText(left.doc).toString()).toBe("Restored body");
		expect(right.getSnapshot().generation).toBe(0);
		right.resume();
		await until(
			() =>
				right.getSnapshot().generation === 1 &&
				right.getSnapshot().ready &&
				right.getSnapshot().saved,
		);
		expect(firstText(right.doc).toString()).toBe("Restored body");
		const recoveryFile = await right.recoveryDownload();
		const bundle = parseRecoveryFile(recoveryFile);
		const oldDoc = new Y.Doc();
		Y.applyUpdate(
			oldDoc,
			Uint8Array.from(bundle.pages[0]!.collaborativeState!.update),
		);
		expect(firstText(oldDoc).toString()).toContain("Offline typing");
		expect(firstText(oldDoc).toString()).toContain("Saved before restore");
		oldDoc.destroy();
		const recovered = await importRecoveryUseCase.run({
			ctx: f.ctx,
			input: {
				workspaceId: f.workspaceId,
				filename: "before-restore.json",
				file: recoveryFile,
			},
		});
		expect(
			JSON.stringify(
				(
					await f.database.repositories.pages.findById(
						f.scope,
						recovered.pages[0]!.id,
					)
				)?.content,
			),
		).toContain("Offline typing");
		firstText(left.doc).insert(0, "New typing ");
		expect(await left.flushServer()).toBe(true);
		await until(
			() => firstText(right.doc).toString() === "New typing Restored body",
		);
		await Promise.all(sessions.map((session) => session.destroy(() => true)));
		await stopDocumentServer(engine);
		await transport.stop(true);
		engine = makeEngine();
		transport = listenDocumentServer(engine, {
			origin: "http://localhost:3000",
			hostname: "127.0.0.1",
			port: Number(new URL(options.url).port),
		});
		const reloaded = new PageDocumentSession(options, requestSession);
		sessions.push(reloaded);
		await reloaded.start();
		await until(() => reloaded.getSnapshot().saved);
		expect(reloaded.getSnapshot().generation).toBe(1);
		expect(reloaded.getSnapshot().recoveries).toEqual([0]);
		expect(firstText(reloaded.doc).toString()).toBe("New typing Restored body");
	} finally {
		await Promise.all(sessions.map((session) => session.destroy(() => true)));
		await stopDocumentServer(engine);
		await transport.stop(true);
		await f.database.close();
	}
}, 20000);

test("failed recovery storage keeps the old document and retry can advance safely", async () => {
	let generation = 0;
	const session = new PageDocumentSession(
		{
			pageId: crypto.randomUUID(),
			workspaceId: "workspace",
			userId: "user",
			url: "ws://127.0.0.1:1",
		},
		async () => ({ token: "unused", generation }),
	);
	session.pause();
	await session.start();
	const source = seedPageBody([paragraph("Keep this unsaved text")]);
	Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(source));
	source.destroy();
	await session.flushLocal();
	const old = session.doc;
	const flush = spyOn(
		LocalDocumentStore.prototype,
		"flush",
	).mockRejectedValueOnce(new Error("Quota exceeded"));
	try {
		generation = 1;
		await session.refreshGeneration();
		expect(session.doc).toBe(old);
		expect(session.getSnapshot().generation).toBe(0);
		expect(session.getSnapshot().storageError).toBe(true);
		expect(firstText(session.doc).toString()).toBe("Keep this unsaved text");
		flush.mockRestore();
		await session.refreshGeneration();
		expect(session.getSnapshot().generation).toBe(1);
		const recovery = parseRecoveryFile(await session.recoveryDownload());
		const recovered = new Y.Doc();
		Y.applyUpdate(
			recovered,
			Uint8Array.from(recovery.pages[0]!.collaborativeState!.update),
		);
		expect(firstText(recovered).toString()).toBe("Keep this unsaved text");
		recovered.destroy();
	} finally {
		flush.mockRestore();
		await session.destroy(() => true);
	}
});

test("late tabs cannot move the cache head backwards or erase each other's recovery edits", async () => {
	const key = crypto.randomUUID();
	const seed = seedPageBody([paragraph("base")]);
	const a = new Y.Doc(),
		b = new Y.Doc();
	for (const doc of [a, b]) Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
	firstText(a).insert(0, "left ");
	firstText(b).insert(4, " right");
	await advanceDocumentGeneration(key, 0, 2, Y.encodeStateAsUpdate(a));
	await advanceDocumentGeneration(key, 0, 1, Y.encodeStateAsUpdate(b));
	expect((await loadDocumentHead(key)).generation).toBe(2);
	const recovered = new Y.Doc();
	Y.applyUpdate(recovered, await readDocumentRecovery(key, 0));
	expect(firstText(recovered).toString()).toBe("left base right");
	const fresh = new Y.Doc(),
		local = new LocalDocumentStore(documentCacheKey(key, 2), fresh, () => {});
	await local.load();
	expect(fresh.getXmlFragment("body").length).toBe(0);
	local.destroy();
	for (const doc of [seed, a, b, recovered, fresh]) doc.destroy();
});
