"use client";

import Dexie, { type Table } from "dexie";
import * as Y from "yjs";

type UpdateRow = { id?: number; key: string; update: Uint8Array };
type DocumentHead = { key: string; generation: number; recoveries: number[] };
class DocumentDatabase extends Dexie {
	updates!: Table<UpdateRow, number>;
	heads!: Table<DocumentHead, string>;
	constructor() {
		super("haunter-yjs-documents-v1");
		this.version(1).stores({ updates: "++id,key" });
		this.version(2).stores({ updates: "++id,key", heads: "key" });
	}
}
let database: DocumentDatabase | undefined;
const getDatabase = () => (database ??= new DocumentDatabase());

// Keep generation zero's original cache key so existing offline drafts survive.
export const documentCacheKey = (key: string, generation: number) =>
	generation === 0 ? key : JSON.stringify([key, "generation", generation]);

export async function loadDocumentHead(key: string): Promise<DocumentHead> {
	return (
		(await getDatabase().heads.get(key)) ?? {
			key,
			generation: 0,
			recoveries: [],
		}
	);
}

/** Archive before advancing the pointer; a storage failure must leave the old editor intact. */
export async function advanceDocumentGeneration(
	key: string,
	from: number,
	to: number,
	state: Uint8Array | null,
) {
	const db = getDatabase();
	return db.transaction("rw", db.updates, db.heads, async () => {
		const head = await loadDocumentHead(key);
		if (state)
			await db.updates.add({ key: documentCacheKey(key, from), update: state });
		const next = {
			key,
			generation: Math.max(head.generation, to),
			recoveries: [
				...new Set([...head.recoveries, ...(state ? [from] : [])]),
			].sort((a, b) => b - a),
		};
		await db.heads.put(next);
		return next;
	});
}

export async function readDocumentRecovery(key: string, generation: number) {
	const rows = await getDatabase()
		.updates.where("key")
		.equals(documentCacheKey(key, generation))
		.toArray();
	if (!rows.length)
		throw new Error(
			"The recovery copy is no longer available in this browser.",
		);
	return Y.mergeUpdates(rows.map((row) => row.update));
}

/** Incremental writes with transaction-completion receipts for the navigation guard. */
export class LocalDocumentStore {
	private pending: Uint8Array[] = [];
	private flight: Promise<void> | null = null;
	private writes = 0;
	private db: DocumentDatabase;
	constructor(
		private key: string,
		private doc: Y.Doc,
		private onStatus: (saved: boolean, error: unknown) => void,
	) {
		this.db = getDatabase();
	}
	async load() {
		const rows = await this.db.updates.where("key").equals(this.key).toArray();
		this.doc.transact(() => {
			for (const row of rows) Y.applyUpdate(this.doc, row.update, this);
		}, this);
		this.doc.on("update", this.onUpdate);
	}
	private onUpdate = (update: Uint8Array, origin: unknown) => {
		if (origin === this) return;
		this.pending.push(update);
		this.onStatus(false, null);
		void this.flush().catch(() => undefined);
	};
	flush(): Promise<void> {
		if (this.flight) return this.flight;
		this.flight = Promise.resolve()
			.then(async () => {
				do {
					while (this.pending.length) {
						const batch = this.pending.slice();
						await this.db.updates.bulkAdd(
							batch.map((update) => ({ key: this.key, update })),
						);
						this.pending.splice(0, batch.length);
						this.writes += batch.length;
					}
					if (this.writes >= 128) {
						await this.db.transaction("rw", this.db.updates, async () => {
							// Read and merge every tab's stored updates within the same transaction.
							const rows = await this.db.updates
								.where("key")
								.equals(this.key)
								.toArray();
							const merged = Y.mergeUpdates(rows.map((row) => row.update));
							await this.db.updates.where("key").equals(this.key).delete();
							await this.db.updates.add({ key: this.key, update: merged });
						});
						this.writes = 0;
					}
				} while (this.pending.length);
				this.onStatus(true, null);
			})
			.catch((error) => {
				this.onStatus(false, error);
				throw error;
			})
			.finally(() => {
				this.flight = null;
			});
		return this.flight;
	}
	destroy() {
		this.doc.off("update", this.onUpdate);
	}
}
