"use client";

const DATABASE_NAME = "haunter-local-drafts";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";
const HINT_PREFIX = "haunter:local-draft:";

export type LocalDraftResourceType = "page" | "canvas";

export type LocalDraft<T> = {
	key: string;
	userId: string;
	workspaceId: string;
	resourceType: LocalDraftResourceType;
	resourceId: string;
	baseVersion: string | null;
	payload: T;
	status: "conflict";
	updatedAt: string;
};

export type LocalDraftBackend = {
	get<T>(key: string): Promise<LocalDraft<T> | null>;
	put<T>(draft: LocalDraft<T>): Promise<void>;
	delete(key: string): Promise<void>;
};

type DraftHints = {
	has(key: string): boolean;
	set(key: string): void;
	delete(key: string): void;
};

export function localDraftKey(
	userId: string,
	resourceType: LocalDraftResourceType,
	resourceId: string,
) {
	return JSON.stringify([userId, resourceType, resourceId]);
}

function requestResult<T>(request: IDBRequest<T>) {
	return new Promise<T>((resolve, reject) => {
		request.addEventListener("success", () => resolve(request.result), {
			once: true,
		});
		request.addEventListener(
			"error",
			() => reject(request.error ?? new Error("IndexedDB request failed.")),
			{ once: true },
		);
	});
}

function transactionFinished(transaction: IDBTransaction) {
	return new Promise<void>((resolve, reject) => {
		transaction.addEventListener("complete", () => resolve(), { once: true });
		transaction.addEventListener(
			"abort",
			() =>
				reject(
					transaction.error ?? new Error("IndexedDB transaction aborted."),
				),
			{ once: true },
		);
		transaction.addEventListener(
			"error",
			() =>
				reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
			{ once: true },
		);
	});
}

function openDraftDatabase() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.addEventListener("upgradeneeded", () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
			}
		});
		request.addEventListener("success", () => resolve(request.result), {
			once: true,
		});
		request.addEventListener(
			"error",
			() =>
				reject(request.error ?? new Error("IndexedDB could not be opened.")),
			{ once: true },
		);
	});
}

const indexedDbBackend: LocalDraftBackend = {
	async get<T>(key: string) {
		const database = await openDraftDatabase();
		try {
			const transaction = database.transaction(STORE_NAME, "readonly");
			const value = await requestResult(
				transaction.objectStore(STORE_NAME).get(key),
			);
			return (value as LocalDraft<T> | undefined) ?? null;
		} finally {
			database.close();
		}
	},
	async put<T>(draft: LocalDraft<T>) {
		const database = await openDraftDatabase();
		try {
			const transaction = database.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).put(draft);
			await transactionFinished(transaction);
		} finally {
			database.close();
		}
	},
	async delete(key: string) {
		const database = await openDraftDatabase();
		try {
			const transaction = database.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).delete(key);
			await transactionFinished(transaction);
		} finally {
			database.close();
		}
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
		} catch {
			// Local recovery must never block the primary server save path.
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
	const operations = new Map<string, Promise<void>>();

	const enqueue = (key: string, operation: () => Promise<void>) => {
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
			hints.set(draft.key);
			return enqueue(draft.key, () => backend.put(draft));
		},
		delete(key: string) {
			return enqueue(key, async () => {
				try {
					await backend.delete(key);
				} finally {
					// A failed IndexedDB deletion must not make a resolved conflict
					// reappear. The unreachable record is replaced by the next put.
					hints.delete(key);
				}
			});
		},
	};
}

const browserDraftStore =
	typeof indexedDB === "undefined" || typeof localStorage === "undefined"
		? null
		: createLocalDraftStore(indexedDbBackend, browserHints);

export function hasLocalDraftHint(key: string) {
	return browserDraftStore?.hasHint(key) ?? false;
}

export function getLocalDraft<T>(key: string) {
	return browserDraftStore?.get<T>(key) ?? Promise.resolve(null);
}

export function putLocalDraft<T>(draft: LocalDraft<T>) {
	return browserDraftStore?.put(draft) ?? Promise.resolve();
}

export function deleteLocalDraft(key: string) {
	return browserDraftStore?.delete(key) ?? Promise.resolve();
}
