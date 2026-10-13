"use client";

import Dexie, { type Table } from "dexie";
import * as Y from "yjs";
import {
	createPersistenceReceipt,
	receiptCoversDocument,
	type PersistenceReceipt,
} from "../receipt";

type SavedReceipt = PersistenceReceipt & { revision: number };
export type LocalRecoveryCopy = {
	generation: number;
	archivedAt: string | null;
	syncStatus: "saved" | "unsynced" | "unknown";
	dismissed: boolean;
	update: Uint8Array;
};

export type RecoveryReadCache = Map<
	number,
	{ signature: string; copy: LocalRecoveryCopy }
>;

type UpdateRow = { id?: number; key: string; update: Uint8Array };
type DocumentHead = {
	key: string;
	generation: number;
	recoveries: number[];
	dismissedRecoveryThrough?: number;
	// Optional fields preserve existing IndexedDB records without a schema upgrade.
	archivedAt?: Record<number, string>;
	receipts?: Record<number, SavedReceipt>;
	dismissedReceipts?: Record<number, PersistenceReceipt>;
};
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
			...head,
			key,
			generation: Math.max(head.generation, to),
			// A late old tab can append to a legacy archive whose date is unknown.
			archivedAt:
				state && !head.recoveries.includes(from)
					? {
							...head.archivedAt,
							[from]: head.archivedAt?.[from] ?? new Date().toISOString(),
						}
					: head.archivedAt,
			recoveries: [
				...new Set([...head.recoveries, ...(state ? [from] : [])]),
			].sort((a, b) => b - a),
		};
		await db.heads.put(next);
		return next;
	});
}

export async function dismissDocumentRecoveryNotice(
	key: string,
	generation: number,
) {
	const db = getDatabase();
	return db.transaction("rw", db.heads, async () => {
		const head = await loadDocumentHead(key);
		const next = {
			...head,
			dismissedRecoveryThrough: Math.max(
				head.dismissedRecoveryThrough ?? -1,
				generation,
			),
		};
		await db.heads.put(next);
		return next;
	});
}

/** Save acknowledgements survive reloads, so a saved old tab doesn't look unsynced. */
export async function saveDocumentReceipt(
	key: string,
	generation: number,
	receipt: SavedReceipt,
) {
	const db = getDatabase();
	await db.transaction("rw", db.heads, async () => {
		const head = await loadDocumentHead(key);
		if ((head.receipts?.[generation]?.revision ?? -1) >= receipt.revision)
			return;
		await db.heads.put({
			...head,
			receipts: {
				...head.receipts,
				[generation]: {
					revision: receipt.revision,
					vector: receipt.vector,
					deletions: receipt.deletions,
				},
			},
		});
	});
}

/** Read every tab's archived updates, rather than just the tab that noticed the reset. */
export async function listDocumentRecoveryCopies(
	key: string,
	cache?: RecoveryReadCache,
): Promise<LocalRecoveryCopy[]> {
	const db = getDatabase();
	return db.transaction("r", db.heads, db.updates, async () => {
		const head = await loadDocumentHead(key);
		return Promise.all(
			head.recoveries.map(async (generation) => {
				const rows = await db.updates
					.where("key")
					.equals(documentCacheKey(key, generation))
					.toArray();
				if (!rows.length)
					throw new Error(
						"The recovery copy is no longer available in this browser.",
					);
				const signature = JSON.stringify([
					rows.map((row) => row.id),
					head.receipts?.[generation],
					head.dismissedReceipts?.[generation],
					head.archivedAt?.[generation],
				]);
				const cached = cache?.get(generation);
				if (cached?.signature === signature) return cached.copy;
				const update = Y.mergeUpdates(rows.map((row) => row.update));
				const doc = new Y.Doc();
				try {
					Y.applyUpdate(doc, update);
					const receipt = head.receipts?.[generation];
					const dismissedReceipt = head.dismissedReceipts?.[generation];
					// Legacy generation-only dismissals cannot prove that later edits were
					// reviewed. Offer those copies again until a content receipt is saved.
					const dismissed = dismissedReceipt
						? receiptCoversDocument(doc, dismissedReceipt)
						: false;

					const copy: LocalRecoveryCopy = {
						generation,
						archivedAt: head.archivedAt?.[generation] ?? null,
						syncStatus: receipt
							? receiptCoversDocument(doc, receipt)
								? "saved"
								: "unsynced"
							: "unknown",
						dismissed,
						update,
					};
					cache?.set(generation, { signature, copy });
					return copy;
				} finally {
					doc.destroy();
				}
			}),
		);
	});
}

/** Dismiss only the exact copies the user saw. Never delete the underlying archive. */
export async function dismissDocumentRecoveryCopies(
	key: string,
	copies: LocalRecoveryCopy[],
) {
	const db = getDatabase();
	await db.transaction("rw", db.heads, async () => {
		const head = await loadDocumentHead(key);
		await db.heads.put({
			...head,
			dismissedReceipts: {
				...head.dismissedReceipts,
				...Object.fromEntries(
					copies.map((copy) => {
						const doc = new Y.Doc();
						try {
							Y.applyUpdate(doc, copy.update);
							return [copy.generation, createPersistenceReceipt(doc)];
						} finally {
							doc.destroy();
						}
					}),
				),
			},
		});
	});
}

export function isRecoveryNoticeDismissed(
	head: Pick<DocumentHead, "recoveries" | "dismissedRecoveryThrough">,
) {
	return head.recoveries.every(
		(generation) => generation <= (head.dismissedRecoveryThrough ?? -1),
	);
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
