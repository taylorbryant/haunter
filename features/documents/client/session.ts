"use client";
import { encodeRecoveryUpdate } from "../update-encoding";

import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { apiClient } from "@/client";
import { draftRegistry } from "@/client/draft-registry";
import type { DurableDraftSnapshot } from "@/client/durable-drafts";
import { getBrowserSessionRecovery } from "@/client/session-recovery";
import { openDocumentSession } from "../contracts";
import {
	DOCUMENT_META,
	DOCUMENT_SCHEMA_VERSION,
	pageDocumentName,
} from "../model";
import { receiptCoversDocument, type PersistenceReceipt } from "../receipt";
import {
	LocalDocumentStore,
	loadDocumentHead,
	documentCacheKey,
	advanceDocumentGeneration,
	readDocumentRecovery,
} from "./local-store";

export type DocumentSnapshot = {
	generation: number;
	restoring: boolean;
	recoveries: number[];
	ready: boolean;
	connected: boolean;
	saved: boolean;
	locallySaved: boolean;
	paused: boolean;
	error: string | null;
	storageError: boolean;
	readySource: "cache" | "server" | null;
	readyMs: number | null;
	revision: number;
	tasksRevision: number;
	linksRevision: number;
};

export class PageDocumentSession {
	doc = new Y.Doc();
	provider: HocuspocusProvider | null = null;
	private listeners = new Set<() => void>();
	private snapshot: DocumentSnapshot = {
		generation: 0,
		restoring: false,
		recoveries: [],
		ready: false,
		connected: false,
		saved: false,
		locallySaved: true,
		paused: false,
		error: null,
		storageError: false,
		readySource: null,
		readyMs: null,
		revision: 0,
		tasksRevision: 0,
		linksRevision: 0,
	};
	private local: LocalDocumentStore;
	private unregister: (() => void) | undefined;
	private tokenTimer: ReturnType<typeof setInterval> | undefined;
	private loadingTimer: ReturnType<typeof setTimeout> | undefined;
	private started = performance.now();
	private disposed = false;
	private loaded = false;
	private flushOnSync = false;
	private generationFlight: Promise<void> | null = null;
	private refreshFlight: Promise<void> | null = null;
	private receipt: PersistenceReceipt | null = null;
	readonly identity;
	constructor(
		readonly options: {
			pageId: string;
			workspaceId: string;
			userId: string;
			url: string;
		},
		private readonly requestSession = () =>
			apiClient
				.endpoint(openDocumentSession)
				.call({ path: { id: options.pageId }, body: {} }),
	) {
		this.identity = {
			key: JSON.stringify([
				options.url,
				options.userId,
				options.workspaceId,
				options.pageId,
				DOCUMENT_SCHEMA_VERSION,
			]),
			userId: options.userId,
			workspaceId: options.workspaceId,
			resourceId: options.pageId,
			resourceType: "page" as const,
		};
		this.local = this.createLocal(this.doc, 0);
	}
	private createLocal(doc: Y.Doc, generation: number) {
		return new LocalDocumentStore(
			documentCacheKey(this.identity.key, generation),
			doc,
			(saved, error) => {
				if (this.doc !== doc) return;
				this.publish({
					locallySaved: saved,
					storageError: !!error,
					...(error
						? {
								error:
									"Changes could not be saved in this browser. Keep this tab open and retry.",
							}
						: this.snapshot.storageError
							? { error: null }
							: {}),
				});
			},
		);
	}

	getSnapshot = () => this.snapshot;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private publish(next: Partial<DocumentSnapshot>) {
		if (this.disposed) return;
		if (
			Object.entries(next).every(
				([key, value]) =>
					this.snapshot[key as keyof DocumentSnapshot] === value,
			)
		)
			return;
		this.snapshot = { ...this.snapshot, ...next };
		for (const listener of this.listeners) listener();
	}
	private ready(source: "cache" | "server") {
		if (
			!this.snapshot.ready &&
			this.doc.getMap(DOCUMENT_META).get("schemaVersion") ===
				DOCUMENT_SCHEMA_VERSION
		) {
			this.publish({
				ready: true,
				readySource: source,
				readyMs: Math.round(performance.now() - this.started),
			});
		}
	}
	async start() {
		try {
			const head = await loadDocumentHead(this.identity.key);
			if (this.disposed) return;
			this.local.destroy();
			this.local = this.createLocal(this.doc, head.generation);
			this.publish({
				generation: head.generation,
				recoveries: head.recoveries,
			});
			await this.local.load();
			if (this.disposed) return;
			this.loaded = true;
			this.ready("cache");
			this.doc.on("update", this.onUpdate);
			this.unregister = draftRegistry.register({
				identity: this.identity,
				subscribe: this.subscribe,
				getSnapshot: this.draftSnapshot,
				pause: this.pause,
				resume: this.resume,
				flushLocal: this.flushLocal,
				flushServer: this.flushServer,
			});
			this.connect();
			this.loadingTimer = setTimeout(() => {
				if (!this.snapshot.ready)
					this.publish({
						error:
							"The document server could not be reached. Retry when the connection is available.",
					});
			}, 8000);
			this.tokenTimer = setInterval(() => {
				if (!this.snapshot.paused && this.snapshot.connected)
					void this.provider?.sendToken();
			}, 120_000);
		} catch {
			this.publish({
				storageError: true,
				locallySaved: false,
				error:
					"Browser recovery storage could not be opened. Retry to load this document.",
			});
		}
	}
	private onUpdate = (_update: Uint8Array, origin: unknown) => {
		this.ready("server");
		// Save receipts can arrive before the provider's batched document update.
		// Recheck coverage so that update cannot leave an already saved page dirty.
		this.publish({
			saved:
				origin === this.provider &&
				this.receipt !== null &&
				receiptCoversDocument(this.doc, this.receipt),
		});
	};
	private connect() {
		if (
			this.provider ||
			this.snapshot.paused ||
			this.snapshot.restoring ||
			this.disposed
		)
			return;
		const doc = this.doc;
		const generation = this.snapshot.generation;
		const current = () =>
			this.doc === doc && !this.disposed && !this.snapshot.restoring;
		this.provider = new HocuspocusProvider({
			url: this.options.url,
			name: pageDocumentName(
				this.options.workspaceId,
				this.options.pageId,
				generation,
			),
			document: this.doc,
			token: async () => {
				const result = await this.requestSession();
				if (!current()) throw new Error("Document session changed");
				if (result.generation !== generation) {
					await this.adoptGeneration(result.generation);
					throw new Error("Document restored");
				}
				return result.token;
			},
			onStatus: ({ status }) =>
				current() && this.publish({ connected: status === "connected" }),
			onClose: ({ event }) => {
				if (current() && event.code === 4409) void this.refreshGeneration();
			},
			onSynced: ({ state }) => {
				if (!current()) return;
				if (state) {
					this.ready("server");
					this.publish({
						error: this.snapshot.storageError ? this.snapshot.error : null,
					});
					this.provider?.sendStateless("receipt");
					if (this.flushOnSync) {
						this.flushOnSync = false;
						this.provider?.sendStateless("flush");
					}
				}
			},
			onAuthenticationFailed: () => {
				if (!current()) return;
				this.publish({
					error:
						"Your connection needs to be verified. Your local changes are preserved.",
				});
				void getBrowserSessionRecovery()?.check();
			},
			onAuthenticated: ({ scope }) => {
				if (!current()) return;
				this.publish({
					error: this.snapshot.storageError ? this.snapshot.error : null,
				});
				if (scope === "readonly") void getBrowserSessionRecovery()?.check();
			},
			onStateless: ({ payload }) => {
				if (!current()) return;
				try {
					const message = JSON.parse(payload);
					if (message.type === "restored") {
						void this.refreshGeneration();
					} else if (message.type === "invalid-document") {
						this.publish({
							saved: false,
							error:
								"This draft contains unsupported content or exceeds the document limits. Download a copy before correcting it and retrying.",
						});
						this.provider?.disconnect();
					} else if (message.type === "storage-error") {
						this.publish({
							saved: false,
							error:
								"The server could not save this document. Changes remain in this browser.",
						});
					} else if (
						message.type === "persisted" &&
						Array.isArray(message.vector) &&
						Array.isArray(message.deletions)
					) {
						const saved = receiptCoversDocument(this.doc, message);
						this.receipt = message;
						this.publish({
							saved,
							revision: message.revision,
							...(message.tasksChanged
								? { tasksRevision: message.revision }
								: {}),
							...(message.linksChanged
								? { linksRevision: message.revision }
								: {}),
							error: this.snapshot.storageError ? this.snapshot.error : null,
						});
					}
				} catch {
					this.publish({ error: "The server sent an invalid save receipt." });
				}
			},
		});
	}
	/** Only the authenticated HTTP response may select a new document generation. */
	refreshGeneration = (): Promise<void> => {
		if (this.refreshFlight) return this.refreshFlight;
		this.refreshFlight = (async () => {
			try {
				const result = await this.requestSession();
				await this.adoptGeneration(result.generation);
			} catch {
				this.publish({
					error:
						"The restored page could not be opened. Your previous copy is preserved. Retry when connected.",
				});
			}
		})().finally(() => {
			this.refreshFlight = null;
		});
		return this.refreshFlight;
	};
	private async adoptGeneration(generation: number): Promise<void> {
		if (this.generationFlight) {
			await this.generationFlight;
			return this.adoptGeneration(generation);
		}
		if (this.disposed || generation === this.snapshot.generation) return;
		if (generation < this.snapshot.generation)
			throw new Error(
				"The server document is older than the cached generation.",
			);
		this.generationFlight = (async () => {
			this.publish({ restoring: true, connected: false, saved: false });
			this.provider?.disconnect();
			try {
				await this.local.flush();
				const previous = this.doc;
				const head = await advanceDocumentGeneration(
					this.identity.key,
					this.snapshot.generation,
					generation,
					this.snapshot.ready ? Y.encodeStateAsUpdate(previous) : null,
				);
				if (this.disposed) return;
				const nextDoc = new Y.Doc();
				const nextLocal = this.createLocal(nextDoc, generation);
				try {
					await nextLocal.load();
				} catch (error) {
					nextLocal.destroy();
					nextDoc.destroy();
					throw error;
				}
				this.provider?.destroy();
				this.provider = null;
				this.local.destroy();
				previous.off("update", this.onUpdate);
				this.doc = nextDoc;
				this.receipt = null;
				this.local = nextLocal;
				this.publish({
					generation,
					recoveries: head.recoveries,
					ready: false,
					readySource: null,
					revision: 0,
					tasksRevision: 0,
					linksRevision: 0,
					error: null,
				});
				this.doc.on("update", this.onUpdate);
				this.ready("cache");
				previous.destroy();
			} catch (error) {
				this.publish({
					error:
						"The previous copy could not be saved in this browser. Keep this tab open, download your drafts, and retry.",
					storageError: true,
				});
				throw error;
			} finally {
				this.publish({ restoring: false });
			}
			this.connect();
		})().finally(() => {
			this.generationFlight = null;
		});
		return this.generationFlight;
	}
	async recoveryDownload(generation = this.snapshot.recoveries[0]) {
		if (
			generation === undefined ||
			!this.snapshot.recoveries.includes(generation)
		)
			throw new Error("Choose an available recovery copy.");
		return JSON.stringify({
			format: "haunter-draft-recovery",
			version: 1,
			pages: [
				{
					type: "page",
					id: `${this.options.pageId}:g${generation}`,
					title: `Recovered page — before restore ${generation + 1}`,
					content: [],
					collaborativeState: {
						format: "haunter-yjs-v1",
						update: encodeRecoveryUpdate(
							await readDocumentRecovery(this.identity.key, generation),
						),
					},
				},
			],
			canvases: [],
		});
	}

	pause = () => {
		this.publish({ paused: true, connected: false });
		this.provider?.disconnect();
	};
	resume = () => {
		if (!this.snapshot.paused) return;
		this.publish({
			paused: false,
			error: this.snapshot.storageError ? this.snapshot.error : null,
		});
		if (this.provider) {
			// connect() can return early while a socket is still closing after pause.
			this.provider.configuration.websocketProvider.shouldConnect = true;
			void this.provider.connect();
		} else this.connect();
	};
	flushLocal = () => this.local.flush();
	flushServer = async (): Promise<boolean> => {
		await this.flushLocal();
		if (this.snapshot.saved) return true;
		if (
			!this.snapshot.connected ||
			this.snapshot.paused ||
			this.snapshot.restoring
		)
			return false;
		this.provider?.sendStateless("flush");
		return new Promise((resolve) => {
			const finish = () => {
				clearTimeout(timeout);
				unsubscribe();
				resolve(this.snapshot.saved);
			};
			const unsubscribe = this.subscribe(() => {
				if (
					this.snapshot.saved ||
					!this.snapshot.connected ||
					this.snapshot.error
				)
					finish();
			});
			const timeout = setTimeout(finish, 5000);
		});
	};
	retry = async () => {
		if (!this.loaded) return this.start();
		await this.local.flush();
		await this.refreshGeneration();
		if (this.snapshot.storageError) return;
		this.publish({ error: null, storageError: false });
		this.flushOnSync = true;
		if (this.provider) {
			this.provider.disconnect();
			this.provider.configuration.websocketProvider.shouldConnect = true;
			void this.provider.connect();
		} else this.connect();
	};
	private draftSnapshot = (): DurableDraftSnapshot<unknown> => {
		const current = this.snapshot;
		const doc = this.doc;
		return {
			status: current.storageError
				? "storage-error"
				: current.paused
					? "paused"
					: current.saved
						? "saved"
						: "pending",
			locallySaved: current.locallySaved,
			remotePaused: current.paused,
			dirty: !current.saved,
			error: current.error,
			validationError: null,
			serverVersion: null,
			serverValue: null,
			get value() {
				return {
					format: "haunter-yjs-v1",
					update: encodeRecoveryUpdate(Y.encodeStateAsUpdate(doc)),
				};
			},
		};
	};
	async destroy(canDispose: () => boolean): Promise<boolean> {
		try {
			await this.flushLocal();
		} catch {
			return false;
		}
		// A page can be reopened while IndexedDB is still flushing. Keep that
		// session attached, and retain failed writes in the cache for recovery.
		if (
			!canDispose() ||
			!this.snapshot.locallySaved ||
			this.generationFlight ||
			this.refreshFlight
		)
			return false;
		this.disposed = true;
		clearInterval(this.tokenTimer);
		clearTimeout(this.loadingTimer);
		this.unregister?.();
		this.doc.off("update", this.onUpdate);
		this.provider?.destroy();
		this.local.destroy();
		this.doc.destroy();
		this.listeners.clear();
		return true;
	}
}

const sessions = new Map<
	string,
	{
		session: PageDocumentSession;
		refs: number;
		timer?: ReturnType<typeof setTimeout>;
	}
>();
export function acquirePageDocument(options: PageDocumentSession["options"]) {
	const key = JSON.stringify(options);
	let entry = sessions.get(key);
	if (!entry) {
		entry = { session: new PageDocumentSession(options), refs: 0 };
		sessions.set(key, entry);
		void entry.session.start();
	}
	clearTimeout(entry.timer);
	entry.refs++;
	const current = entry;
	const disposeWhenUnused = async () => {
		if (current.refs > 0) return;
		const disposed = await current.session.destroy(() => current.refs === 0);
		if (disposed) sessions.delete(key);
		else if (current.refs === 0)
			current.timer = setTimeout(() => void disposeWhenUnused(), 60_000);
	};
	let released = false;
	return {
		session: entry.session,
		release() {
			if (released) return;
			released = true;
			current.refs--;
			if (current.refs === 0)
				current.timer = setTimeout(() => void disposeWhenUnused(), 60_000);
		},
	};
}

/** Let the initiating tab switch immediately; other tabs learn through the worker. */
export async function refreshPageDocumentSessions(pageId: string) {
	await Promise.all(
		[...sessions.values()]
			.filter(({ session }) => session.options.pageId === pageId)
			.map(({ session }) => session.refreshGeneration()),
	);
}
