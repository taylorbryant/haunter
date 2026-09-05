"use client";

import {
	type AnyActorRef,
	assign,
	createActor,
	fromPromise,
	setup,
} from "xstate";
import {
	acknowledgeLocalDraftSave,
	deleteLocalDraft,
	getLocalDraft,
	type LocalDraft,
	type LocalDraftResourceType,
	putLocalDraft,
} from "@/client/local-drafts";

export type DurableDraftIdentity = {
	key: string;
	userId: string;
	workspaceId: string;
	resourceType: LocalDraftResourceType;
	resourceId: string;
};

export type DurableDraftStorage<T> = {
	load(key: string): Promise<LocalDraft<T> | null>;
	persist(draft: LocalDraft<T>): Promise<void>;
	discard(key: string): Promise<void>;
	acknowledge(
		key: string,
		savedWriteId: string,
		serverVersion: string | null,
	): Promise<LocalDraft<T> | null>;
};

export const browserDurableDraftStorage: DurableDraftStorage<unknown> = {
	load: getLocalDraft,
	persist: putLocalDraft,
	discard: deleteLocalDraft,
	acknowledge: acknowledgeLocalDraftSave,
};

export type DurableDraftServerSave<T, Metadata = never> = {
	value: T;
	version: string | null;
	metadata?: Metadata;
};

export type DurableDraftStatus =
	| "loading"
	| "saved"
	| "saving-local"
	| "pending"
	| "syncing"
	| "conflict"
	| "resolving"
	| "invalid"
	| "storage-error"
	| "sync-error";

export type DurableDraftSnapshot<T> = {
	status: DurableDraftStatus;
	value: T;
	serverValue: T;
	serverVersion: string | null;
	error: unknown;
	validationError: string | null;
	dirty: boolean;
};

type DraftContext<T> = {
	value: T;
	serverValue: T;
	serverVersion: string | null;
	baseVersion: string | null;
	revision: number;
	durableRevision: number;
	durableWriteId: string | null;
	ackedRevision: number;
	durableValue: T;
	error: unknown;
};

type DraftEvent<T> =
	| { type: "EDIT"; value: T; revision: number }
	| {
			type: "LOCAL_COMMITTED";
			value: T;
			revision: number;
			writeId: string;
			baseVersion: string | null;
	  }
	| { type: "LOCAL_FAILED"; error: unknown }
	| { type: "KEEP_MINE"; revision: number }
	| { type: "BEGIN_USE_SERVER" }
	| { type: "USE_SERVER" }
	| { type: "RETRY" }
	| { type: "SYNC_NOW" }
	| { type: "ADOPT_SERVER"; value: T; version: string | null }
	| { type: "REBASE_SERVER"; value: T; version: string | null }
	| { type: "SERVER_CONFLICT"; value: T; version: string | null }
	| { type: "RESOLUTION_FAILED"; error: unknown };

type MachineInput<T> = {
	serverValue: T;
	serverVersion: string | null;
};

type SyncInput<T> = {
	value: T;
	revision: number;
	writeId: string;
	baseVersion: string | null;
};

type SyncOutput<T, Metadata> = DurableDraftServerSave<T, Metadata> & {
	revision: number;
	writeId: string;
};

export type DurableDraftControllerOptions<T, Metadata = never> = {
	identity: DurableDraftIdentity;
	serverValue: T;
	serverVersion: string | null;
	storage?: DurableDraftStorage<T>;
	localDebounceMs?: number;
	debounceMs?: number;
	isPayload(value: unknown): value is T;
	isStoredDraftResumable?: (
		draft: LocalDraft<T>,
		serverValue: T,
		serverVersion: string | null,
	) => boolean;
	areValuesEqual?: (left: T, right: T) => boolean;
	validate?: (value: T) => string | null;
	isConflictError?: (error: unknown) => boolean;
	loadServer?: () => Promise<DurableDraftServerSave<T, Metadata>>;
	onServerSaved?: (result: DurableDraftServerSave<T, Metadata>) => void;
	saveServer(input: {
		value: T;
		baseVersion: string | null;
	}): Promise<DurableDraftServerSave<T, Metadata>>;
	now?: () => string;
	createWriteId?: () => string;
};

class ServerConflict<T, Metadata = never> extends Error {
	constructor(
		readonly latest: DurableDraftServerSave<T, Metadata>,
		readonly cause: unknown,
	) {
		super("The server value changed before this draft could be saved.");
		this.name = "DurableDraftServerConflict";
	}
}

function defaultWriteId() {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
	);
}

function invocationOutput<T>(event: unknown) {
	return (event as { output: T }).output;
}

function invocationError(event: unknown) {
	return (event as { error: unknown }).error;
}

/**
 * Resource-scoped local-first draft actor.
 *
 * Local writes are serialized independently from server synchronization. A
 * component may disappear at any point after edit() and the queued durable
 * write still completes; a later actor reconstructs its state from storage.
 */
export class DurableDraftController<T, Metadata = never> {
	readonly key: string;
	private readonly options: DurableDraftControllerOptions<T, Metadata>;
	private readonly storage: DurableDraftStorage<T>;
	private readonly actor: AnyActorRef;
	private readonly listeners = new Set<() => void>();
	private localTail: Promise<void> = Promise.resolve();
	private pendingLocal: {
		value: T;
		revision: number;
		writeId: string;
		status: LocalDraft<T>["status"];
	} | null = null;
	private localTimer: ReturnType<typeof setTimeout> | null = null;
	private lastLocalError: unknown = null;
	private nextRevision = 0;
	private writeBaseVersion: string | null;
	private pendingServerRefresh: { value: T; version: string | null } | null =
		null;
	private started = false;
	private stopped = false;
	private view: DurableDraftSnapshot<T>;
	private uncontrolledView: DurableDraftSnapshot<T>;

	constructor(options: DurableDraftControllerOptions<T, Metadata>) {
		this.key = options.identity.key;
		this.options = options;
		this.storage =
			options.storage ?? (browserDurableDraftStorage as DurableDraftStorage<T>);
		this.writeBaseVersion = options.serverVersion;
		this.view = {
			status: "loading",
			value: options.serverValue,
			serverValue: options.serverValue,
			serverVersion: options.serverVersion,
			error: null,
			validationError: null,
			dirty: false,
		};
		this.uncontrolledView = this.view;

		const machine = setup({
			types: {
				context: {} as DraftContext<T>,
				events: {} as DraftEvent<T>,
				input: {} as MachineInput<T>,
			},
			actors: {
				loadDraft: fromPromise(async () => this.loadStoredDraft()),
				syncDraft: fromPromise(
					async ({
						input,
						signal,
					}: {
						input: SyncInput<T>;
						signal: AbortSignal;
					}) => this.syncToServer(input, signal),
				),
			},
			delays: {
				remoteDebounce: options.debounceMs ?? 500,
			},
			guards: {
				noStoredDraft: ({ event }) =>
					invocationOutput<LocalDraft<T> | null>(event) === null,
				storedDraftIsResumable: ({ event, context }) => {
					const draft = invocationOutput<LocalDraft<T>>(event);
					if (options.isStoredDraftResumable) {
						return options.isStoredDraftResumable(
							draft,
							context.serverValue,
							context.serverVersion,
						);
					}
					return (
						draft.status === "unsaved" &&
						draft.baseVersion === context.serverVersion
					);
				},
				valueIsInvalid: ({ context }) =>
					Boolean(options.validate?.(context.durableValue)),
				hasPendingDurableDraft: ({ context }) =>
					context.durableRevision > context.ackedRevision,
				hasNewerDurableDraft: ({ context, event }) =>
					context.durableRevision >
					invocationOutput<SyncOutput<T, Metadata>>(event).revision,
				isServerConflict: ({ event }) =>
					invocationError(event) instanceof ServerConflict,
			},
			actions: {
				restoreResumableDraft: assign(({ context, event }) => {
					const draft = invocationOutput<LocalDraft<T>>(event);
					const revision = draft.revision ?? 1;
					this.nextRevision = Math.max(this.nextRevision, revision);
					this.writeBaseVersion = context.serverVersion;
					return {
						...context,
						value: draft.payload,
						durableValue: draft.payload,
						baseVersion: context.serverVersion,
						revision,
						durableRevision: revision,
						durableWriteId: draft.writeId ?? null,
						error: null,
					};
				}),
				restoreConflictingDraft: assign(({ context, event }) => {
					const draft = invocationOutput<LocalDraft<T>>(event);
					const revision = draft.revision ?? 1;
					this.nextRevision = Math.max(this.nextRevision, revision);
					this.writeBaseVersion = draft.baseVersion;
					return {
						...context,
						value: draft.payload,
						durableValue: draft.payload,
						baseVersion: draft.baseVersion,
						revision,
						durableRevision: revision,
						durableWriteId: draft.writeId ?? null,
						error: null,
					};
				}),
				applyEdit: assign(({ context, event }) =>
					event.type === "EDIT"
						? {
								...context,
								value: event.value,
								revision: event.revision,
								error: null,
							}
						: context,
				),
				applyLocalCommit: assign(({ context, event }) =>
					event.type === "LOCAL_COMMITTED"
						? {
								...context,
								durableValue: event.value,
								durableRevision: Math.max(
									context.durableRevision,
									event.revision,
								),
								durableWriteId: event.writeId,
								baseVersion: event.baseVersion,
								error: null,
							}
						: context,
				),
				applyLocalFailure: assign(({ context, event }) => ({
					...context,
					error:
						event.type === "LOCAL_FAILED" || event.type === "RESOLUTION_FAILED"
							? event.error
							: context.error,
				})),
				applyServerSave: assign(({ context, event }) => {
					const output = invocationOutput<SyncOutput<T, Metadata>>(event);
					return {
						...context,
						value:
							context.revision <= output.revision
								? output.value
								: context.value,
						serverValue: output.value,
						serverVersion: output.version,
						baseVersion: output.version,
						ackedRevision: Math.max(context.ackedRevision, output.revision),
						error: null,
					};
				}),
				applyInvocationFailure: assign(({ context, event }) => ({
					...context,
					error: invocationError(event),
				})),
				prepareKeepMine: assign(({ context, event }) =>
					event.type === "KEEP_MINE"
						? {
								...context,
								revision: event.revision,
								baseVersion: context.serverVersion,
								error: null,
							}
						: context,
				),
				useServerValue: assign(({ context }) => ({
					...context,
					value: context.serverValue,
					durableValue: context.serverValue,
					baseVersion: context.serverVersion,
					durableRevision: context.ackedRevision,
					revision: context.ackedRevision,
					error: null,
				})),
				adoptServerValue: assign(({ context, event }) =>
					event.type === "ADOPT_SERVER"
						? {
								...context,
								value: event.value,
								durableValue: event.value,
								serverValue: event.value,
								serverVersion: event.version,
								baseVersion: event.version,
								error: null,
							}
						: context,
				),
				rebaseServerValue: assign(({ context, event }) =>
					event.type === "REBASE_SERVER"
						? {
								...context,
								serverValue: event.value,
								serverVersion: event.version,
								baseVersion: event.version,
								error: null,
							}
						: context,
				),
				captureServerConflict: assign(({ context, event }) =>
					event.type === "SERVER_CONFLICT"
						? {
								...context,
								serverValue: event.value,
								serverVersion: event.version,
								error: null,
							}
						: context,
				),
				captureInvocationConflict: assign(({ context, event }) => {
					const conflict = invocationError(event);
					if (!(conflict instanceof ServerConflict)) return context;
					return {
						...context,
						serverValue: conflict.latest.value as T,
						serverVersion: conflict.latest.version,
						error: null,
					};
				}),
			},
		}).createMachine({
			id: `durable-draft:${options.identity.key}`,
			initial: "loading",
			context: ({ input }) => ({
				value: input.serverValue,
				serverValue: input.serverValue,
				serverVersion: input.serverVersion,
				baseVersion: input.serverVersion,
				revision: 0,
				durableRevision: 0,
				durableWriteId: null,
				ackedRevision: 0,
				durableValue: input.serverValue,
				error: null,
			}),
			on: {
				ADOPT_SERVER: { actions: "adoptServerValue" },
				REBASE_SERVER: { actions: "rebaseServerValue" },
				SERVER_CONFLICT: {
					target: ".conflict",
					actions: "captureServerConflict",
				},
			},
			states: {
				loading: {
					invoke: {
						src: "loadDraft",
						onDone: [
							{ guard: "noStoredDraft", target: "clean" },
							{
								guard: "storedDraftIsResumable",
								target: "scheduled",
								actions: "restoreResumableDraft",
							},
							{ target: "conflict", actions: "restoreConflictingDraft" },
						],
						onError: {
							target: "storageError",
							actions: "applyInvocationFailure",
						},
					},
				},
				clean: {
					on: {
						EDIT: { actions: "applyEdit" },
						LOCAL_COMMITTED: {
							target: "scheduled",
							actions: "applyLocalCommit",
						},
						LOCAL_FAILED: {
							target: "storageError",
							actions: "applyLocalFailure",
						},
						SYNC_NOW: {
							guard: "hasPendingDurableDraft",
							target: "syncing",
						},
					},
				},
				scheduled: {
					after: {
						remoteDebounce: [
							{ guard: "valueIsInvalid", target: "invalid" },
							{ target: "syncing" },
						],
					},
					on: {
						EDIT: { actions: "applyEdit" },
						LOCAL_COMMITTED: {
							target: "scheduled",
							reenter: true,
							actions: "applyLocalCommit",
						},
						LOCAL_FAILED: {
							target: "storageError",
							actions: "applyLocalFailure",
						},
						SYNC_NOW: [
							{ guard: "valueIsInvalid", target: "invalid" },
							{ target: "syncing" },
						],
					},
				},
				syncing: {
					invoke: {
						src: "syncDraft",
						input: ({ context }) => ({
							value: context.durableValue,
							revision: context.durableRevision,
							writeId: context.durableWriteId ?? "",
							baseVersion: context.baseVersion,
						}),
						onDone: [
							{
								guard: "hasNewerDurableDraft",
								target: "scheduled",
								actions: "applyServerSave",
							},
							{ target: "clean", actions: "applyServerSave" },
						],
						onError: [
							{
								guard: "isServerConflict",
								target: "conflict",
								actions: "captureInvocationConflict",
							},
							{
								target: "syncError",
								actions: "applyInvocationFailure",
							},
						],
					},
					on: {
						EDIT: { actions: "applyEdit" },
						LOCAL_COMMITTED: { actions: "applyLocalCommit" },
						LOCAL_FAILED: {
							target: "storageError",
							actions: "applyLocalFailure",
						},
					},
				},
				conflict: {
					on: {
						EDIT: { actions: "applyEdit" },
						LOCAL_COMMITTED: { actions: "applyLocalCommit" },
						LOCAL_FAILED: {
							target: "storageError",
							actions: "applyLocalFailure",
						},
						KEEP_MINE: {
							target: "clean",
							actions: "prepareKeepMine",
						},
						BEGIN_USE_SERVER: { target: "resolving" },
						RESOLUTION_FAILED: { actions: "applyLocalFailure" },
					},
				},
				resolving: {
					on: {
						LOCAL_COMMITTED: { actions: "applyLocalCommit" },
						LOCAL_FAILED: {
							target: "conflict",
							actions: "applyLocalFailure",
						},
						USE_SERVER: {
							target: "clean",
							actions: "useServerValue",
						},
						RESOLUTION_FAILED: {
							target: "conflict",
							actions: "applyLocalFailure",
						},
					},
				},
				invalid: {
					on: {
						EDIT: { actions: "applyEdit" },
						LOCAL_COMMITTED: {
							target: "scheduled",
							actions: "applyLocalCommit",
						},
						LOCAL_FAILED: {
							target: "storageError",
							actions: "applyLocalFailure",
						},
					},
				},
				storageError: {
					on: {
						EDIT: { actions: "applyEdit" },
						LOCAL_COMMITTED: {
							target: "scheduled",
							actions: "applyLocalCommit",
						},
						LOCAL_FAILED: { actions: "applyLocalFailure" },
					},
				},
				syncError: {
					on: {
						EDIT: { actions: "applyEdit" },
						LOCAL_COMMITTED: {
							target: "scheduled",
							actions: "applyLocalCommit",
						},
						LOCAL_FAILED: {
							target: "storageError",
							actions: "applyLocalFailure",
						},
						RETRY: { target: "syncing" },
					},
				},
			},
		});

		this.actor = createActor(machine, {
			input: {
				serverValue: options.serverValue,
				serverVersion: options.serverVersion,
			},
		});
		this.actor.subscribe((snapshot) => {
			this.updateView(snapshot as { value: unknown; context: DraftContext<T> });
		});
	}

	start() {
		if (this.started || this.stopped) return;
		this.started = true;
		this.actor.start();
	}

	stop() {
		if (this.stopped) return;
		this.commitPendingLocal();
		this.stopped = true;
		this.actor.stop();
		this.listeners.clear();
	}

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	getSnapshot = () => this.view;
	/**
	 * Snapshot for editors that already own their live value (BlockNote/tldraw).
	 * It suppresses React work for repeated local edits in the same actor state,
	 * while still publishing lifecycle, conflict, error, and remote changes.
	 */
	getUncontrolledSnapshot = () => this.uncontrolledView;

	edit(value: T) {
		if (this.view.status === "resolving") return;
		const revision = this.allocateRevision();
		const writeId = (this.options.createWriteId ?? defaultWriteId)();
		const status = this.view.status === "conflict" ? "conflict" : "unsaved";
		this.actor.send({ type: "EDIT", value, revision });
		this.scheduleLocalRevision(value, revision, writeId, status);
	}

	retry() {
		if (this.view.status === "storage-error") {
			this.edit(this.view.value);
			return;
		}
		this.actor.send({ type: "RETRY" });
	}

	refreshServer(value: T, version: string | null) {
		if (
			version === this.view.serverVersion &&
			(version !== null || Object.is(value, this.view.serverValue))
		) {
			return;
		}
		// A successful compare-and-set determines the ordering of concurrent
		// writes. Hold refreshes while it is unresolved: if another write committed
		// first this save returns 409; if this save committed first, the refresh is
		// the newer server value and can be applied after acknowledgement.
		if (this.view.status === "syncing" || this.view.status === "resolving") {
			if (version !== this.writeBaseVersion) {
				this.pendingServerRefresh = { value, version };
			}
			return;
		}
		if (!this.view.dirty) {
			this.writeBaseVersion = version;
			this.actor.send({ type: "ADOPT_SERVER", value, version });
			return;
		}
		// A previous instance of this editor can finish its unmount save after a
		// new instance has already restored the same durable draft. The ensuing
		// query refresh carries a newer version, but it is not a conflict: the
		// server now contains exactly what this editor is trying to save. Leave the
		// draft scheduled so its normal compare-and-set path can acknowledge and
		// remove the recovery row without briefly alarming the user.
		const areValuesEqual = this.options.areValuesEqual ?? Object.is;
		if (
			this.view.status !== "conflict" &&
			areValuesEqual(value, this.view.value)
		) {
			return;
		}
		this.actor.send({ type: "SERVER_CONFLICT", value, version });
	}

	rebaseServer(value: T, version: string | null) {
		this.writeBaseVersion = version;
		this.actor.send({ type: "REBASE_SERVER", value, version });
	}

	keepMine() {
		if (this.view.status !== "conflict") return;
		const revision = this.allocateRevision();
		const writeId = (this.options.createWriteId ?? defaultWriteId)();
		this.writeBaseVersion = this.view.serverVersion;
		this.actor.send({ type: "KEEP_MINE", revision });
		this.scheduleLocalRevision(this.view.value, revision, writeId, "unsaved");
	}

	async useServer() {
		if (this.view.status !== "conflict") return false;
		this.actor.send({ type: "BEGIN_USE_SERVER" });
		try {
			await this.flushLocal();
			await this.enqueueLocal(async () => {
				await this.storage.discard(this.options.identity.key);
			});
			this.lastLocalError = null;
			this.writeBaseVersion = this.view.serverVersion;
			this.actor.send({ type: "USE_SERVER" });
			return true;
		} catch (error) {
			this.actor.send({ type: "RESOLUTION_FAILED", error });
			return false;
		}
	}

	async flushLocal() {
		this.commitPendingLocal();
		await this.localTail;
		if (this.lastLocalError) throw this.lastLocalError;
	}

	async flushServer() {
		try {
			await this.flushLocal();
		} catch {
			return false;
		}
		if (this.view.status === "loading") {
			await new Promise<void>((resolve) => {
				const unsubscribe = this.subscribe(() => {
					if (this.view.status === "loading") return;
					unsubscribe();
					resolve();
				});
			});
		}
		if (this.view.status === "saved") return true;
		if (
			this.view.status === "conflict" ||
			this.view.status === "resolving" ||
			this.view.status === "invalid" ||
			this.view.status === "storage-error"
		) {
			return false;
		}
		this.actor.send({
			type: this.view.status === "sync-error" ? "RETRY" : "SYNC_NOW",
		});
		return new Promise<boolean>((resolve) => {
			const unsubscribe = this.subscribe(() => {
				if (this.view.status === "saved") {
					unsubscribe();
					resolve(true);
				} else if (
					this.view.status === "conflict" ||
					this.view.status === "invalid" ||
					this.view.status === "storage-error" ||
					this.view.status === "sync-error"
				) {
					unsubscribe();
					resolve(false);
				}
			});
		});
	}

	private allocateRevision() {
		this.nextRevision = Math.max(
			this.nextRevision,
			(this.actor.getSnapshot() as { context: DraftContext<T> }).context
				.revision,
		);
		this.nextRevision += 1;
		return this.nextRevision;
	}

	private async loadStoredDraft() {
		let draft = await this.storage.load(this.options.identity.key);
		if (!draft) return null;
		const identity = this.options.identity;
		const valid =
			draft.key === identity.key &&
			draft.userId === identity.userId &&
			draft.workspaceId === identity.workspaceId &&
			draft.resourceType === identity.resourceType &&
			draft.resourceId === identity.resourceId &&
			this.options.isPayload(draft.payload);
		if (valid) {
			const areValuesEqual = this.options.areValuesEqual ?? Object.is;
			if (areValuesEqual(draft.payload, this.options.serverValue)) {
				await this.storage.discard(identity.key);
				return null;
			}
			if (!draft.writeId) {
				draft = {
					...draft,
					writeId: (this.options.createWriteId ?? defaultWriteId)(),
				};
				await this.storage.persist(draft);
			}
			return draft;
		}
		await this.storage.discard(identity.key);
		return null;
	}

	private persistRevision(
		value: T,
		revision: number,
		writeId: string,
		status: LocalDraft<T>["status"],
	) {
		void this.enqueueLocal(async () => {
			const baseVersion = this.writeBaseVersion;
			try {
				await this.storage.persist({
					...this.options.identity,
					baseVersion,
					payload: value,
					status,
					updatedAt: (this.options.now ?? (() => new Date().toISOString()))(),
					revision,
					writeId,
				});
				this.lastLocalError = null;
				this.actor.send({
					type: "LOCAL_COMMITTED",
					value,
					revision,
					writeId,
					baseVersion,
				});
			} catch (error) {
				this.lastLocalError = error;
				this.actor.send({ type: "LOCAL_FAILED", error });
			}
		});
	}

	private scheduleLocalRevision(
		value: T,
		revision: number,
		writeId: string,
		status: LocalDraft<T>["status"],
	) {
		const delay = this.options.localDebounceMs ?? 0;
		if (delay <= 0) {
			this.persistRevision(value, revision, writeId, status);
			return;
		}
		this.pendingLocal = { value, revision, writeId, status };
		if (this.localTimer) clearTimeout(this.localTimer);
		this.localTimer = setTimeout(() => this.commitPendingLocal(), delay);
	}

	private commitPendingLocal() {
		if (this.localTimer) {
			clearTimeout(this.localTimer);
			this.localTimer = null;
		}
		const pending = this.pendingLocal;
		if (!pending) return;
		this.pendingLocal = null;
		this.persistRevision(
			pending.value,
			pending.revision,
			pending.writeId,
			pending.status,
		);
	}

	private enqueueLocal(operation: () => Promise<void>) {
		const result = this.localTail.catch(() => undefined).then(operation);
		this.localTail = result.catch(() => undefined);
		return result;
	}

	private async syncToServer(
		input: SyncInput<T>,
		signal: AbortSignal,
	): Promise<SyncOutput<T, Metadata>> {
		let result: DurableDraftServerSave<T, Metadata>;
		try {
			result = await this.options.saveServer({
				value: input.value,
				baseVersion: input.baseVersion,
			});
		} catch (error) {
			if (this.options.isConflictError?.(error) && this.options.loadServer) {
				const latest = await this.options.loadServer();
				const areValuesEqual = this.options.areValuesEqual ?? Object.is;
				if (areValuesEqual(latest.value, input.value)) {
					result = latest;
				} else {
					throw new ServerConflict(latest, error);
				}
			} else {
				throw error;
			}
		}
		// XState aborts an invocation when an external server refresh moves the
		// actor into conflict (or the owner stops). The HTTP write may be too late
		// to cancel, but its obsolete completion must never delete the local draft.
		if (signal.aborted) {
			return { ...result, revision: input.revision, writeId: input.writeId };
		}
		// Advance the base synchronously before another browser event can enqueue a
		// write, then serialize the durable acknowledgement behind older writes.
		this.writeBaseVersion = result.version;
		await this.enqueueLocal(async () => {
			await this.storage.acknowledge(
				this.options.identity.key,
				input.writeId,
				result.version,
			);
		});
		this.lastLocalError = null;
		if (!signal.aborted) this.options.onServerSaved?.(result);
		return { ...result, revision: input.revision, writeId: input.writeId };
	}

	private updateView(snapshot: { value: unknown; context: DraftContext<T> }) {
		const machineState = String(snapshot.value);
		const context = snapshot.context;
		const validationError = this.options.validate?.(context.value) ?? null;
		let status: DurableDraftStatus;
		if (machineState === "loading") status = "loading";
		else if (machineState === "conflict") status = "conflict";
		else if (machineState === "resolving") status = "resolving";
		else if (machineState === "storageError") status = "storage-error";
		else if (machineState === "syncError") status = "sync-error";
		else if (machineState === "invalid" || validationError) status = "invalid";
		else if (context.revision > context.durableRevision)
			status = "saving-local";
		else if (machineState === "syncing") status = "syncing";
		else if (machineState === "scheduled") status = "pending";
		else status = "saved";

		const nextView = {
			status,
			value: context.value,
			serverValue: context.serverValue,
			serverVersion: context.serverVersion,
			error: context.error,
			validationError,
			dirty:
				context.revision > context.ackedRevision || machineState === "conflict",
		};
		this.view = nextView;
		const previousUncontrolled = this.uncontrolledView;
		if (
			previousUncontrolled.status !== nextView.status ||
			previousUncontrolled.serverValue !== nextView.serverValue ||
			previousUncontrolled.serverVersion !== nextView.serverVersion ||
			previousUncontrolled.error !== nextView.error ||
			previousUncontrolled.validationError !== nextView.validationError ||
			previousUncontrolled.dirty !== nextView.dirty
		) {
			this.uncontrolledView = nextView;
		}
		for (const listener of this.listeners) listener();
		if (
			status !== "syncing" &&
			status !== "resolving" &&
			this.pendingServerRefresh
		) {
			const pending = this.pendingServerRefresh;
			this.pendingServerRefresh = null;
			queueMicrotask(() => {
				if (!this.stopped) this.refreshServer(pending.value, pending.version);
			});
		}
	}
}
