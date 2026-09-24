import { expect, test } from "bun:test";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { editDocumentBlocks } from "@/infra/documents/block-edits";
import { projectPageBody, seedPageBody } from "@/infra/documents/codec";
import { loadPageBody, persistPageBody } from "@/infra/documents/persistence";
import {
	prepareDocumentUpdate,
	validateDocumentState,
} from "@/infra/documents/validate-update";
import { editPageBlocksUseCase } from "@/features/pages/use-cases/edit-page-blocks";
import { createDocumentServer } from "@/infra/documents/hocuspocus";
import {
	listenDocumentServer,
	stopDocumentServer,
} from "@/infra/documents/bun-transport";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { checkDocumentAccess } from "@/infra/documents/access";
import { pageDocumentName } from "../model";
import { documentRevision } from "../revision";
import {
	documentFixture,
	firstText,
	paragraph,
	seedFixtureBody,
} from "./helpers";

function fork(source: Y.Doc | Uint8Array) {
	const doc = new Y.Doc();
	Y.applyUpdate(
		doc,
		source instanceof Y.Doc ? Y.encodeStateAsUpdate(source) : source,
	);
	return doc;
}

/** Browser dragging reinserts a subtree without the MCP's move metadata. */
function browserMove(doc: Y.Doc, from: number, to: number) {
	const group = doc.getXmlFragment("body").get(0) as Y.XmlElement;
	doc.transact(() => {
		const node = (group.get(from) as Y.XmlElement).clone();
		group.delete(from, 1);
		group.insert(to, [node]);
	});
}

test("moving the last nested child is atomic and cannot erase a pending sibling", async () => {
	const f = await documentFixture();
	const docs: Y.Doc[] = [];
	try {
		await seedFixtureBody(f, [
			{
				...paragraph("Parent", "parent"),
				children: [paragraph("Child", "child")],
			},
			paragraph("Tail", "tail"),
		]);
		const before = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		const history = await f.database.repositories.pageVersions.listMetaByPage(
			f.scope,
			f.page.id,
		);
		const client = fork(before.state);
		docs.push(client);
		const [sibling] = editDocumentBlocks(client, [
			{
				op: "insert",
				parentBlockId: "parent",
				afterBlockId: "child",
				blocks: [
					{
						type: "paragraph",
						content: [{ type: "text", text: "Pending sibling", styles: {} }],
					},
				],
			},
		]);
		await expect(
			editPageBlocksUseCase.run({
				ctx: f.ctx,
				input: {
					id: f.page.id,
					expectedRevision: documentRevision(before),
					operations: [
						{
							op: "update",
							blockId: "tail",
							props: { textAlignment: "right" },
						},
						{ op: "move", blockId: "child", afterBlockId: "tail" },
					],
				},
			}),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
		expect(await loadPageBody(f.ctx, f.workspaceId, f.page.id)).toEqual(before);
		expect(
			await f.database.repositories.pageVersions.listMetaByPage(
				f.scope,
				f.page.id,
			),
		).toEqual(history);
		const saved = await persistPageBody(f.ctx, {
			...f.grant,
			baseRevision: before.revision,
			doc: client,
		});
		const merged = fork(saved.state);
		docs.push(merged);
		expect(projectPageBody(merged)[0]?.children.map((b) => b.id)).toEqual([
			"child",
			sibling!,
		]);
		expect(JSON.stringify(projectPageBody(merged))).toContain(
			"Pending sibling",
		);
	} finally {
		docs.forEach((doc) => doc.destroy());
		await f.database.close();
	}
});

test.each(["incoming", "refresh"])(
	"identical concurrent moves merge atomically through %s",
	(direction) => {
		const base = seedPageBody([
			{ ...paragraph("A", "a"), children: [paragraph("Nested", "nested")] },
			paragraph("B", "b"),
			paragraph("C", "c"),
		]);
		const server = fork(base),
			client = fork(base);
		try {
			editDocumentBlocks(server, [
				{ op: "move", blockId: "a", afterBlockId: "c" },
			]);
			browserMove(client, 0, 1);
			const target = direction === "incoming" ? server : client;
			const incoming = direction === "incoming" ? client : server;
			let broadcasts = 0;
			target.on("update", () => {
				broadcasts++;
				validateDocumentState(target);
			});
			const prepared = prepareDocumentUpdate(
				target,
				Y.encodeStateAsUpdate(incoming),
			);
			expect(prepared.repaired).toBe(true);
			Y.applyUpdate(target, prepared.update);
			Y.applyUpdate(target, Y.encodeStateAsUpdate(incoming));
			expect(broadcasts).toBe(1);
			expect(projectPageBody(target).map((b) => b.id)).toEqual(["b", "c", "a"]);
			expect(projectPageBody(target)[2]?.children.map((b) => b.id)).toEqual([
				"nested",
			]);
			expect(
				prepareDocumentUpdate(target, Y.encodeStateAsUpdate(incoming)).repaired,
			).toBe(false);
		} finally {
			base.destroy();
			server.destroy();
			client.destroy();
		}
	},
);

test("saving an older worker reconciles concurrent moves and keeps subsequent updates writable", async () => {
	const f = await documentFixture();
	const docs: Y.Doc[] = [];
	try {
		await seedFixtureBody(f, [
			paragraph("A", "a"),
			paragraph("B", "b"),
			paragraph("C", "c"),
		]);
		const before = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		const worker = fork(before.state);
		docs.push(worker);
		browserMove(worker, 0, 1);
		await editPageBlocksUseCase.run({
			ctx: f.ctx,
			input: {
				id: f.page.id,
				expectedRevision: documentRevision(before),
				operations: [{ op: "move", blockId: "a", afterBlockId: "c" }],
			},
		});
		const saved = await persistPageBody(f.ctx, {
			...f.grant,
			baseRevision: before.revision,
			doc: worker,
		});
		Y.applyUpdate(worker, saved.state);
		expect(projectPageBody(worker).map((b) => b.id)).toEqual(["b", "c", "a"]);
		expect(() => validateDocumentState(worker)).not.toThrow();
		const stored = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		expect(stored.generation).toBe(before.generation);
		firstText(worker).insert(0, "Still editable. ");
		await persistPageBody(f.ctx, {
			...f.grant,
			baseRevision: saved.revision,
			doc: worker,
		});
		expect(
			JSON.stringify(
				(await f.database.repositories.pages.findById(f.scope, f.page.id))
					?.content,
			),
		).toContain("Still editable. B");
	} finally {
		docs.forEach((doc) => doc.destroy());
		await f.database.close();
	}
});

test("divergent concurrent moves leave both the saved page and pending draft intact", async () => {
	const f = await documentFixture();
	const docs: Y.Doc[] = [];
	try {
		await seedFixtureBody(f, [
			paragraph("A", "a"),
			paragraph("B", "b"),
			paragraph("C", "c"),
		]);
		const before = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		const client = fork(before.state);
		docs.push(client);
		firstText(client).insert(0, "Pending text. ");
		browserMove(client, 0, 1);
		await editPageBlocksUseCase.run({
			ctx: f.ctx,
			input: {
				id: f.page.id,
				expectedRevision: documentRevision(before),
				operations: [{ op: "move", blockId: "a", afterBlockId: "c" }],
			},
		});
		const committed = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		const server = fork(committed.state);
		docs.push(server);
		const pending = Y.encodeStateAsUpdate(client);
		expect(() => prepareDocumentUpdate(server, pending)).toThrow(
			"different content",
		);
		expect(() => prepareDocumentUpdate(client, committed.state)).toThrow(
			"different content",
		);
		await expect(
			persistPageBody(f.ctx, {
				...f.grant,
				baseRevision: before.revision,
				doc: client,
			}),
		).rejects.toThrow("different content");
		expect(await loadPageBody(f.ctx, f.workspaceId, f.page.id)).toEqual(
			committed,
		);
		expect(Y.encodeStateAsUpdate(client)).toEqual(pending);
		expect(JSON.stringify(projectPageBody(client))).toContain(
			"Pending text. A",
		);
	} finally {
		docs.forEach((doc) => doc.destroy());
		await f.database.close();
	}
});

test("duplicate IDs without MCP move provenance remain invalid", () => {
	const doc = seedPageBody([paragraph("A", "a"), paragraph("B", "b")]);
	try {
		const group = doc.getXmlFragment("body").get(0) as Y.XmlElement;
		group.insert(1, [(group.get(0) as Y.XmlElement).clone()]);
		expect(() => prepareDocumentUpdate(doc, new Uint8Array([0, 0]))).toThrow(
			"Duplicate block ID",
		);
	} finally {
		doc.destroy();
	}
});

async function until(condition: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + 6000;
	while (!(await condition())) {
		if (Date.now() > deadline)
			throw new Error("Timed out waiting for move reconciliation");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

test.each(["incoming", "refresh", "conflicting-content"])(
	"live %s moves reconcile or report a recoverable conflict without invalid state",
	async (direction) => {
		const f = await documentFixture();
		await seedFixtureBody(f, [
			paragraph("A", "a"),
			paragraph("B", "b"),
			paragraph("C", "c"),
		]);
		const tokens = createDocumentSessionTokens(
			"move-conflict-test-secret-at-least-32-characters",
		);
		const health: boolean[] = [];
		const engine = createDocumentServer({
			origin: "http://localhost:3000",
			verify: tokens.verify,
			onStorageHealth: (_name, healthy) => health.push(healthy),
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
			origin: "http://localhost:3000",
			hostname: "127.0.0.1",
			port: 0,
		});
		const docs = [new Y.Doc(), new Y.Doc()];
		const errors: unknown[] = [];
		const providers = docs.map(
			(document) =>
				new HocuspocusProvider({
					url: `ws://127.0.0.1:${transport.port}`,
					name: pageDocumentName(f.workspaceId, f.page.id),
					token: tokens.issue(f.grant).token,
					document,
					onStateless: ({ payload }) => {
						const message = JSON.parse(payload);
						if (
							message.type === "invalid-document" ||
							message.type === "storage-error"
						)
							errors.push(message);
					},
				}),
		);
		try {
			await until(() => providers.every((provider) => provider.isSynced));
			const [observer, moving] = docs as [Y.Doc, Y.Doc];
			const observed: string[][] = [];
			observer.on("update", () =>
				observed.push(projectPageBody(observer).map((b) => b.id)),
			);
			if (direction === "incoming") {
				providers[1]!.disconnect();
				await until(
					() =>
						providers[1]!.configuration.websocketProvider.status ===
						"disconnected",
				);
			}
			if (direction === "conflicting-content")
				firstText(moving).insert(0, "Pending text. ");
			browserMove(moving, 0, 1);
			if (direction !== "incoming")
				await until(() => projectPageBody(observer)[1]?.id === "a");
			const before = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
			await editPageBlocksUseCase.run({
				ctx: f.ctx,
				input: {
					id: f.page.id,
					expectedRevision: documentRevision(before),
					operations: [{ op: "move", blockId: "a", afterBlockId: "c" }],
				},
			});
			if (direction === "conflicting-content") {
				const committed = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
				await until(() => errors.length > 0);
				const count = errors.length;
				providers[0]!.sendStateless("flush");
				await until(() => errors.length > count);
				expect(errors).toContainEqual({
					type: "invalid-document",
					reason: "move-conflict",
				});
				expect(health).not.toContain(false);
				expect(await loadPageBody(f.ctx, f.workspaceId, f.page.id)).toEqual(
					committed,
				);
				for (const doc of docs) {
					validateDocumentState(doc);
					expect(projectPageBody(doc).map((block) => block.id)).toEqual([
						"b",
						"a",
						"c",
					]);
					expect(JSON.stringify(projectPageBody(doc))).toContain(
						"Pending text. A",
					);
				}
				return;
			}
			await until(() => projectPageBody(observer)[2]?.id === "a");
			if (direction === "incoming") await providers[1]!.connect();
			await until(
				() =>
					providers.every((provider) => provider.isSynced) &&
					docs.every(
						(doc) =>
							projectPageBody(doc)
								.map((b) => b.id)
								.join() === "b,c,a",
					),
			);
			providers[0]!.sendStateless("flush");
			await until(
				async () =>
					(await loadPageBody(f.ctx, f.workspaceId, f.page.id)).revision >
					before.revision + 1,
			);
			const saved = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
			const reloaded = fork(saved.state);
			try {
				validateDocumentState(reloaded);
				expect(projectPageBody(reloaded).map((b) => b.id)).toEqual([
					"b",
					"c",
					"a",
				]);
				expect(saved.generation).toBe(0);
			} finally {
				reloaded.destroy();
			}
			firstText(moving).insert(0, "Continued typing. ");
			await until(() =>
				firstText(observer).toString().startsWith("Continued typing."),
			);
			providers[0]!.sendStateless("flush");
			await until(async () =>
				JSON.stringify(
					(await f.database.repositories.pages.findById(f.scope, f.page.id))
						?.content,
				).includes("Continued typing. B"),
			);
			expect(
				observed.every((ids) => ids.length === 3 && new Set(ids).size === 3),
			).toBe(true);
			expect(errors).toEqual([]);
		} finally {
			providers.forEach((provider) => provider.destroy());
			await stopDocumentServer(engine);
			await transport.stop(true);
			docs.forEach((doc) => doc.destroy());
			await f.database.close();
		}
	},
	15_000,
);
