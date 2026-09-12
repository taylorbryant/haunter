import { expect, test } from "bun:test";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDocumentMaintenance } from "@/infra/documents/migration";
import { loadPageBody } from "@/infra/documents/persistence";
import * as schema from "@/infra/db/schema";
import { documentFixture, paragraph } from "./helpers";

test("offline cutover validates and backs up live and trashed pages, preserving existing CRDT identity on rerun", async () => {
	const f = await documentFixture();
	const backupPath = join(
		tmpdir(),
		`haunter-migration-test-${crypto.randomUUID()}.json`,
	);
	const url = `file:${f.database.path}`;
	const maintenance = createDocumentMaintenance(f.database.db, url);
	try {
		const original = JSON.stringify([
			paragraph("Original body with whitespace\n  kept\n"),
		]);
		await f.database.db.delete(schema.collaborativeDocuments);
		await f.database.db
			.update(schema.pages)
			.set({ content: original, deletedAt: new Date().toISOString() });
		await expect(loadPageBody(f.ctx, f.workspaceId, f.page.id)).rejects.toThrow(
			"not migrated",
		);
		expect(await maintenance.migrate({ dryRun: true })).toMatchObject({
			pages: 1,
			converted: 1,
			existing: 0,
			trashed: 1,
		});
		expect(
			await f.database.db.select().from(schema.collaborativeDocuments),
		).toHaveLength(0);
		await expect(
			maintenance.migrate({
				dryRun: false,
				backupPath,
				expectedDatabase: "wrong",
			}),
		).rejects.toThrow("expectedDatabase");
		await maintenance.migrate({
			dryRun: false,
			backupPath,
			expectedDatabase: url,
		});
		const backup = JSON.parse(await readFile(backupPath, "utf8"));
		expect(backup.pages[0].content).toBe(original);
		expect((await stat(backupPath)).mode & 0o777).toBe(0o600);
		const first = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		expect(await maintenance.migrate({ dryRun: true })).toMatchObject({
			converted: 0,
			existing: 1,
		});
		await expect(
			maintenance.migrate({ dryRun: false, backupPath, expectedDatabase: url }),
		).rejects.toThrow();
		expect((await loadPageBody(f.ctx, f.workspaceId, f.page.id)).state).toEqual(
			first.state,
		);
	} finally {
		await rm(backupPath, { force: true });
		await f.database.close();
	}
});

test("preflight rejects unrepresentable source fields and projection drift before any writes", async () => {
	const f = await documentFixture();
	try {
		const maintenance = createDocumentMaintenance(
			f.database.db,
			`file:${f.database.path}`,
		);
		await f.database.db
			.update(schema.pages)
			.set({ content: JSON.stringify([paragraph("Not in the Yjs snapshot")]) });
		await expect(maintenance.migrate({ dryRun: true })).rejects.toThrow(
			f.page.id,
		);
		await f.database.db
			.delete(schema.collaborativeDocuments)
			.where(eq(schema.collaborativeDocuments.pageId, f.page.id));
		await f.database.db.update(schema.pages).set({
			content: JSON.stringify([
				{
					...paragraph("Text"),
					props: { unknownImportantProp: "must not vanish" },
				},
			]),
		});
		await expect(maintenance.migrate({ dryRun: true })).rejects.toThrow(
			f.page.id,
		);
		expect(
			await f.database.db.select().from(schema.collaborativeDocuments),
		).toHaveLength(0);
	} finally {
		await f.database.close();
	}
});
