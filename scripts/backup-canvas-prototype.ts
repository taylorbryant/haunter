/** Run only when upgrading a database that used the abandoned canvas Yjs prototype.
 * Stop both writers before this pre-schema backup. Normal production cutovers
 * from JSON canvases do not need it; still take a full database backup.
 */
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import * as Y from "yjs";
import { databaseClient } from "@/infra/db/client";
import { env } from "@/lib/env";
import { projectCanvas } from "@/infra/documents/legacy-canvas";
import {
	canonicalCanvas,
	normalizeCanvasSnapshot,
} from "@/features/canvases/lib/document";

const [expectedDatabase, backupPath] = process.argv.slice(2);
const database = env.SQLITE_DB_URL.startsWith("file:")
	? env.SQLITE_DB_URL
	: new URL(env.SQLITE_DB_URL).hostname;
if (expectedDatabase !== database || !backupPath || !isAbsolute(backupPath))
	throw new Error(
		"Supply the exact database hostname and a new absolute backup filename.",
	);
const lease = await databaseClient.execute(
	"SELECT expires_at FROM collaboration_worker_lease WHERE id = 1",
);
if (lease.rows.some((row) => Number(row.expires_at) > Date.now()))
	throw new Error("Stop the collaboration worker first.");
const canvases = await databaseClient.execute("SELECT * FROM canvases");
const documents = await databaseClient.execute(
	"SELECT * FROM collaborative_canvases",
);
for (const row of documents.rows) {
	const canvas = canvases.rows.find((canvas) => canvas.id === row.canvas_id);
	if (!canvas || canvas.workspace_id !== row.workspace_id)
		throw new Error(`Orphan/mismatched canvas ${row.canvas_id}`);
	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, new Uint8Array(row.state as ArrayBuffer));
		if (doc.store.pendingStructs || doc.store.pendingDs)
			throw new Error("Incomplete state");
		if (
			canonicalCanvas(projectCanvas(doc)) !==
			canonicalCanvas(
				normalizeCanvasSnapshot(JSON.parse(String(canvas.snapshot))),
			)
		)
			throw new Error("Projection mismatch");
	} catch {
		throw new Error(
			`Canvas ${row.canvas_id} failed validation; do not apply schema migration 0043.`,
		);
	} finally {
		doc.destroy();
	}
}
const file = await open(backupPath, "wx", 0o600);
try {
	await file.writeFile(
		JSON.stringify({
			format: "haunter-canvas-yjs-cutover-v1",
			database,
			createdAt: new Date().toISOString(),
			canvases: canvases.rows,
			documents: documents.rows.map((row) => ({
				...row,
				state: Buffer.from(row.state as ArrayBuffer).toString("base64"),
			})),
		}),
	);
	await file.sync();
} finally {
	await file.close();
	databaseClient.close();
}
console.info(
	JSON.stringify({
		database,
		canvases: canvases.rows.length,
		verified: documents.rows.length,
		backupPath,
	}),
);
