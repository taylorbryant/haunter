import { seedFixtureBody } from "@/features/documents/tests/helpers";
import { expect, test } from "bun:test";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { createDocumentServer } from "@/infra/documents/hocuspocus";
import {
	listenDocumentServer,
	stopDocumentServer,
} from "@/infra/documents/bun-transport";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { projectPageBody } from "@/infra/documents/codec";
import { checkDocumentAccess } from "@/infra/documents/access";
import { pageDocumentName } from "../model";
import { documentFixture, firstText } from "./helpers";

async function until(condition: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + 5000;
	while (!(await condition())) {
		if (Date.now() > deadline)
			throw new Error("Timed out waiting for collaboration");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

test("two clients merge disconnected changes, persist deletion, and survive server restart", async () => {
	const f = await documentFixture();
	await seedFixtureBody(
		f,
		JSON.parse(
			JSON.stringify([
				{
					id: "initial",
					type: "paragraph",
					props: {},
					content: [{ type: "text", text: "start", styles: {} }],
					children: [],
				},
			]),
		),
	);
	const tokens = createDocumentSessionTokens(
		"protocol-test-secret-at-least-32-characters",
	);
	const token = tokens.issue(f.grant).token;
	const name = pageDocumentName(f.workspaceId, f.page.id);
	const makeServer = () =>
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
	let engine = makeServer();
	let transport = listenDocumentServer(engine, {
		port: 0,
		hostname: "127.0.0.1",
		origin: "http://localhost:3000",
	});
	let url = `ws://127.0.0.1:${transport.port}`;
	const docs = [new Y.Doc(), new Y.Doc()];
	let providers = docs.map(
		(document) => new HocuspocusProvider({ url, name, token, document }),
	);
	try {
		await until(() => providers.every((provider) => provider.isSynced));
		await until(() => firstText(docs[1]!).toString() === "start");
		providers.forEach((provider) => provider.disconnect());
		await until(() =>
			providers.every(
				(provider) =>
					provider.configuration.websocketProvider.status === "disconnected",
			),
		);
		firstText(docs[0]!).insert(0, "left ");
		firstText(docs[1]!).insert(5, " right");
		await Promise.all(providers.map((provider) => provider.connect()));
		await until(
			() =>
				providers.every((provider) => provider.isSynced) &&
				firstText(docs[0]!).toString() === "left start right" &&
				firstText(docs[1]!).toString() === "left start right",
		);
		firstText(docs[1]!).delete(5, 5);
		await until(() => firstText(docs[0]!).toString() === "left  right");
		await until(async () =>
			JSON.stringify(
				(await f.database.repositories.pages.findById(f.scope, f.page.id))
					?.content,
			).includes("left  right"),
		);
		providers.forEach((provider) => provider.destroy());
		providers = [];
		await stopDocumentServer(engine);
		await transport.stop(true);
		engine = makeServer();
		transport = listenDocumentServer(engine, {
			port: 0,
			hostname: "127.0.0.1",
			origin: "http://localhost:3000",
		});
		url = `ws://127.0.0.1:${transport.port}`;
		const reloaded = new Y.Doc();
		docs.push(reloaded);
		providers.push(
			new HocuspocusProvider({ url, name, token, document: reloaded }),
		);
		await until(() => providers[0]!.isSynced);
		expect(firstText(reloaded).toString()).toBe("left  right");
		expect(projectPageBody(reloaded)).toEqual(projectPageBody(docs[0]!));
	} finally {
		providers.forEach((provider) => provider.destroy());
		await stopDocumentServer(engine);
		await transport.stop(true);
		docs.forEach((doc) => doc.destroy());
		await f.database.close();
	}
}, 20_000);
