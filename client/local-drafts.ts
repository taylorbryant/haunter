"use client";

import Dexie, { type Table } from "dexie";

const DATABASE_NAME = "haunter-local-drafts";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";
const HINT_PREFIX = "haunter:local-draft:";

export type LocalDraftResourceType = "page" | "page-title" | "canvas";

export type LocalDraft<T> = {
	key: string;
	userId: string;
	workspaceId: string;
	resourceType: LocalDraftResourceType;
	resourceId: string;
	baseVersion: string | null;
	payload: T;
	status: "conflict" | "unsaved";
	updatedAt: string;
	/** Monotonic per-resource revision used to reconcile overlapping saves. */
	revision?: number;
	/** Globally unique token for the exact browser write represented by this row. */
	writeId?: string;
};

export type LocalDraftBackend = {
	get<T>(key: string): Promise<LocalDraft<T> | null>;
	put<T>(draft: LocalDraft<T>): Promise<void>;
	delete(key: string): Promise<void>;
	acknowledgeSaved?<T>(
		key: string,
		savedWriteId: string,
		serverVersion: string | null,
	): Promise<LocalDraft<T> | null>;
};

type DraftHints = {
	has(key: string): boolean;
	set(key: string): boolean;
	delete(key: string): void;
};

const LOCAL_DRAFT_STORAGE_UNAVAILABLE_MESSAGE =
	"Local recovery storage is unavailable.";

export function localDraftKey(
	userId: string,
	resourceType: LocalDraftResourceType,
	resourceId: string,
) {
	return JSON.stringify([userId, resourceType, resourceId]);
}

class LocalDraftDatabase extends Dexie {
	drafts!: Table<LocalDraft<unknown>, string>;

	constructor() {
		super(DATABASE_NAME);
		// This describes the existing v1 database, so adopting Dexie does not
		// invalidate recovery copies written by the previous native-IDB adapter.
		this.version(DATABASE_VERSION).stores({ [STORE_NAME]: "key" });
	}
}

let draftDatabase: LocalDraftDatabase | null = null;

function getDraftDatabase() {
	draftDatabase ??= new LocalDraftDatabase();
	return draftDatabase;
}

const indexedDbBackend: LocalDraftBackend = {
	async get<T>(key: string) {
		const value = await getDraftDatabase().drafts.get(key);
		return (value as LocalDraft<T> | undefined) ?? null;
	},
	async put<T>(draft: LocalDraft<T>) {
		await getDraftDatabase().drafts.put(draft as LocalDraft<unknown>);
	},
	async delete(key: string) {
		await getDraftDatabase().drafts.delete(key);
	},
	async acknowledgeSaved<T>(
		key: string,
		savedWriteId: string,
		serverVersion: string | null,
	) {
		const database = getDraftDatabase();
		return database.transaction("rw", database.drafts, async () => {
			const current = (await database.drafts.get(key)) as
				| LocalDraft<T>
				| undefined;
			if (!current) return null;
			if (current.writeId === savedWriteId) {
				await database.drafts.delete(key);
				return null;
			}
			const remaining = {
				...current,
				baseVersion: serverVersion,
				status: "unsaved" as const,
			};
			await database.drafts.put(remaining as LocalDraft<unknown>);
			return remaining;
		});
	},
};

const browserHints: DraftHints = {
	has: (key) => {
		try {
			return localStorage.getItem(`${HINT_PREFIX}${key}`) === "1";
		} catch {
			return false;
		}
	},
	set: (key) => {
		try {
			localStorage.setItem(`${HINT_PREFIX}${key}`, "1");
			return true;
		} catch {
			return false;
		}
	},
	delete: (key) => {
		try {
			localStorage.removeItem(`${HINT_PREFIX}${key}`);
		} catch {
			// A stale hint is safe: the next read removes it when possible.
		}
	},
};

export function createLocalDraftStore(
	backend: LocalDraftBackend,
	hints: DraftHints,
) {
	const operations = new Map<string, Promise<unknown>>();

	const enqueue = <T>(key: string, operation: () => Promise<T>) => {
		const previous = operations.get(key) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(operation);
		operations.set(key, next);
		const cleanup = () => {
			if (operations.get(key) === next) operations.delete(key);
		};
		void next.then(cleanup, cleanup);
		return next;
	};

	return {
		hasHint(key: string) {
			return hints.has(key);
		},
		async get<T>(key: string) {
			await operations.get(key)?.catch(() => undefined);
			const draft = await backend.get<T>(key);
			if (!draft) hints.delete(key);
			return draft;
		},
		put<T>(draft: LocalDraft<T>) {
			if (!hints.set(draft.key)) {
				return Promise.reject(
					new Error(LOCAL_DRAFT_STORAGE_UNAVAILABLE_MESSAGE),
				);
			}
			return enqueue(draft.key, () => backend.put(draft));
		},
		delete(key: string) {
			return enqueue(key, async () => {
				await backend.delete(key);
				hints.delete(key);
			});
		},
		acknowledgeSaved<T>(
			key: string,
			savedWriteId: string,
			serverVersion: string | null,
		) {
			return enqueue(key, async () => {
				let remaining: LocalDraft<T> | null;
				if (backend.acknowledgeSaved) {
					remaining = await backend.acknowledgeSaved<T>(
						key,
						savedWriteId,
						serverVersion,
					);
				} else {
					const current = await backend.get<T>(key);
					if (!current || current.writeId === savedWriteId) {
						await backend.delete(key);
						remaining = null;
					} else {
						remaining = {
							...current,
							baseVersion: serverVersion,
							status: "unsaved",
						};
						await backend.put(remaining);
					}
				}
				if (remaining) {
					if (!hints.set(key)) {
						throw new Error(LOCAL_DRAFT_STORAGE_UNAVAILABLE_MESSAGE);
					}
				} else {
					hints.delete(key);
				}
				return remaining;
			});
		},
	};
}

function createBrowserDraftStore() {
	try {
		if (
			typeof indexedDB === "undefined" ||
			typeof localStorage === "undefined"
		) {
			return null;
		}
		return createLocalDraftStore(indexedDbBackend, browserHints);
	} catch {
		return null;
	}
}

const browserDraftStore = createBrowserDraftStore();

export function hasLocalDraftHint(key: string) {
	return browserDraftStore?.hasHint(key) ?? false;
}

export function getLocalDraft<T>(key: string) {
	return browserDraftStore?.get<T>(key) ?? Promise.resolve(null);
}

export async function putLocalDraft<T>(draft: LocalDraft<T>) {
	if (!browserDraftStore) {
		throw new Error(LOCAL_DRAFT_STORAGE_UNAVAILABLE_MESSAGE);
	}
	await browserDraftStore.put(draft);
}

export function deleteLocalDraft(key: string) {
	return browserDraftStore?.delete(key) ?? Promise.resolve();
}

export async function acknowledgeLocalDraftSave<T>(
	key: string,
	savedWriteId: string,
	serverVersion: string | null,
) {
	if (!browserDraftStore) {
		throw new Error(LOCAL_DRAFT_STORAGE_UNAVAILABLE_MESSAGE);
	}
	return browserDraftStore.acknowledgeSaved<T>(
		key,
		savedWriteId,
		serverVersion,
	);
}
