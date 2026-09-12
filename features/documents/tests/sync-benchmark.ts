import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { createDocumentServer } from "@/infra/documents/hocuspocus";
import {
	listenDocumentServer,
	stopDocumentServer,
} from "@/infra/documents/bun-transport";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { checkDocumentAccess } from "@/infra/documents/access";
import { PageDocumentSession } from "../client/session";
import { firstText, type documentFixture } from "./helpers";

type Measure = <T>(name: string, run: () => T | Promise<T>) => Promise<T>;
async function until(condition: () => boolean) {
	const deadline = performance.now() + 15_000;
	while (!condition()) {
		if (performance.now() > deadline)
			throw new Error("Synchronization benchmark timed out");
		await Bun.sleep(1);
	}
}

/** Real local WebSockets and SQL; fake IndexedDB, with no DOM or HTTP login timing. */
export async function benchmarkSync(
	f: Awaited<ReturnType<typeof documentFixture>>,
	samples: number,
	measure: Measure,
) {
	Dexie.dependencies.indexedDB = indexedDB;
	Dexie.dependencies.IDBKeyRange = IDBKeyRange;
	const tokens = createDocumentSessionTokens(
		"isolated-benchmark-secret-32-characters",
	);
	const engine = createDocumentServer({
		origin: "http://localhost:3000",
		verify: tokens.verify,
		authorize: async (grant) => ({
			ctx: f.ctx,
			role: await checkDocumentAccess(grant, f.database.db),
		}),
	});
	const transport = listenDocumentServer(engine, {
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
	const grant = async () => ({ ...tokens.issue(f.grant), generation: 0 });
	const left = new PageDocumentSession(options, grant);
	const right = new PageDocumentSession(options, grant);
	try {
		await measure("localWebSocketColdBodyReadyMs", async () => {
			await left.start();
			await until(() => left.getSnapshot().ready);
		});
		if (!(await left.flushServer()))
			throw new Error("Cold session did not persist");
		await left.flushLocal();
		await measure("fakeIndexedDbWarmBodyReadyMs", async () => {
			await right.start();
			await until(() => right.getSnapshot().ready);
		});
		await until(() => right.getSnapshot().saved);
		for (let i = 0; i < samples; i++) {
			await measure("localWebSocketEditToPeerMs", async () => {
				firstText(left.doc).insert(0, "z");
				const expected = firstText(left.doc).toString();
				await until(() => firstText(right.doc).toString() === expected);
			});
			await measure("localWebSocketSaveReceiptMs", async () => {
				if (!(await left.flushServer()))
					throw new Error("Edit did not persist");
			});
		}
		right.pause();
		await until(
			() =>
				right.provider?.configuration.websocketProvider.status ===
				"disconnected",
		);
		for (let i = 0; i < 50; i++) firstText(right.doc).insert(0, "r");
		await right.flushLocal();
		await measure("localWebSocketReconnect50EditsMs", async () => {
			right.resume();
			await until(
				() =>
					right.getSnapshot().saved &&
					firstText(left.doc).toString() === firstText(right.doc).toString(),
			);
		});
	} finally {
		await Promise.all([left.destroy(() => true), right.destroy(() => true)]);
		await stopDocumentServer(engine);
		await transport.stop(true);
	}
}
