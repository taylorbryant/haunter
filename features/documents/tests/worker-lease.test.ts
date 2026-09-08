import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { createWorkerLease } from "@/infra/documents/worker-lease";
import { persistPageBody } from "@/infra/documents/persistence";
import * as schema from "@/infra/db/schema";
import { documentFixture, firstText } from "./helpers";

test("only one worker owns the database and expired/replaced workers cannot commit", async () => {
	const f = await documentFixture();
	const first = createWorkerLease(f.database.db);
	const second = createWorkerLease(f.database.db);
	const doc = new Y.Doc();
	try {
		await first.acquire();
		await expect(second.acquire()).rejects.toThrow(
			"Another collaboration worker",
		);
		await first.renew();
		const stored = await f.database.repositories.documents.find(
			f.scope,
			f.page.id,
		);
		Y.applyUpdate(doc, stored!.state);
		firstText(doc).insert(0, "Accepted by first worker");
		await persistPageBody(f.ctx, {
			...f.grant,
			doc,
			baseRevision: 0,
			workerOwnerId: first.ownerId,
		});
		await f.database.db
			.update(schema.collaborationWorkerLease)
			.set({ expiresAt: Date.now() - 1 })
			.where(eq(schema.collaborationWorkerLease.id, 1));
		await second.acquire();
		firstText(doc).insert(0, "Must not commit");
		await expect(
			persistPageBody(f.ctx, {
				...f.grant,
				doc,
				baseRevision: 1,
				workerOwnerId: first.ownerId,
			}),
		).rejects.toThrow("lease expired");
		expect(
			(await f.database.repositories.documents.find(f.scope, f.page.id))
				?.revision,
		).toBe(1);
		await expect(first.renew()).rejects.toThrow("lease lost");
		await first.release();
		await second.renew();
	} finally {
		doc.destroy();
		await second.release();
		await f.database.close();
	}
});
