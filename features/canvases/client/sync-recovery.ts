import type { TLStore, TLStoreSnapshot } from "tldraw";
import type {
	DurableDraftIdentity,
	DurableDraftSnapshot,
	DurableDraftStorage,
} from "@/client/durable-drafts";
import { canvasFingerprint, canonicalCanvas } from "../lib/document";

/**
 * Quiet time after the last document change before the recovery copy is
 * serialized, and the longest a continuous edit stream (a drag) can defer it.
 * Serializing canonicalizes the whole store, so doing it per store event made
 * large canvases drop frames; the navigation guard still sees edits at once.
 */
export const CANVAS_RECOVERY_CAPTURE_DEBOUNCE_MS = 250;
export const CANVAS_RECOVERY_CAPTURE_MAX_WAIT_MS = 1000;

/** A recovery copy only. Live merging and undo remain entirely inside tldraw sync. */
export class CanvasSyncRecovery {
	readonly identity: DurableDraftIdentity;
	private listeners = new Set<() => void>();
	private value: TLStoreSnapshot;
	private encoded: string;
	private acknowledged: string | null = null;
	private pending: Promise<void> = Promise.resolve();
	private version = 0;
	private saved = true;
	private uncaptured = false;
	private locallySaved = true;
	private error: unknown = null;
	private paused = false;
	private unregister: () => void;
	private captureTimer: ReturnType<typeof setTimeout> | null = null;
	private captureDeadline = 0;
	private readonly captureDebounceMs: number;
	private readonly captureMaxWaitMs: number;
	constructor(
		readonly store: TLStore,
		identity: Omit<DurableDraftIdentity, "key" | "resourceType">,
		private storage: DurableDraftStorage<TLStoreSnapshot>,
		private reconnect: () => void,
		options: { captureDebounceMs?: number; captureMaxWaitMs?: number } = {},
	) {
		this.captureDebounceMs =
			options.captureDebounceMs ?? CANVAS_RECOVERY_CAPTURE_DEBOUNCE_MS;
		this.captureMaxWaitMs =
			options.captureMaxWaitMs ?? CANVAS_RECOVERY_CAPTURE_MAX_WAIT_MS;
		this.identity = {
			...identity,
			resourceType: "canvas",
			key: JSON.stringify([
				identity.userId,
				"canvas",
				identity.resourceId,
				"tldraw",
				crypto.randomUUID(),
			]),
		};
		this.value = store.getStoreSnapshot();
		this.encoded = canonicalCanvas(this.value);
		// Mark edits synchronously, so navigation guards and downloads see the
		// final keystroke at once; the serialized copy itself is captured after a
		// quiet period (or the max wait) rather than on every store event.
		const mark = (source: "user" | "remote") => {
			if (source !== "user" || this.uncaptured) return;
			this.uncaptured = true;
			this.publish();
		};
		const stops = [...store.scopedTypes.document].flatMap((type) => [
			store.sideEffects.registerAfterCreateHandler(type, (_record, source) =>
				mark(source),
			),
			store.sideEffects.registerAfterChangeHandler(
				type,
				(_before, _after, source) => mark(source),
			),
			store.sideEffects.registerAfterDeleteHandler(type, (_record, source) =>
				mark(source),
			),
		]);
		stops.push(
			store.listen(() => this.scheduleCapture(), { scope: "document" }),
		);
		this.unregister = () => {
			for (const stop of stops) stop();
		};
	}
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private publish() {
		for (const listener of this.listeners) listener();
	}
	getSnapshot = (): DurableDraftSnapshot<TLStoreSnapshot> => ({
		value: this.uncaptured ? this.store.getStoreSnapshot() : this.value,
		serverValue: this.value,
		serverVersion: this.acknowledged,
		dirty: this.uncaptured || !this.saved,
		locallySaved: !this.uncaptured && this.locallySaved,
		remotePaused: this.paused,
		error: this.error,
		validationError: null,
		status: this.error
			? "storage-error"
			: this.paused
				? "paused"
				: this.uncaptured
					? "saving-local"
					: this.saved
						? "saved"
						: this.locallySaved
							? "pending"
							: "saving-local",
	});
	private scheduleCapture() {
		const now = Date.now();
		if (this.captureTimer === null)
			this.captureDeadline = now + this.captureMaxWaitMs;
		else clearTimeout(this.captureTimer);
		this.captureTimer = setTimeout(
			this.capture,
			Math.max(0, Math.min(this.captureDebounceMs, this.captureDeadline - now)),
		);
	}
	private capture = () => {
		if (this.captureTimer !== null) {
			clearTimeout(this.captureTimer);
			this.captureTimer = null;
		}
		const next = this.store.getStoreSnapshot();
		const encoded = canonicalCanvas(next);
		const wasUncaptured = this.uncaptured;
		this.uncaptured = false;
		if (encoded === this.encoded) {
			if (wasUncaptured) {
				// Edits that cancelled out before this capture (create, then undo)
				// may still have reached the server as intermediate pushes, so the
				// copy stays unsaved until a receipt matches the current state.
				if (this.saved) {
					this.version++;
					this.saved = false;
					this.locallySaved = false;
					this.queueSave();
				}
				this.publish();
			}
			return;
		}
		this.value = next;
		this.encoded = encoded;
		this.version++;
		this.saved = false;
		this.locallySaved = false;
		this.publish();
		this.queueSave();
	};
	private queueSave() {
		const value = this.value,
			version = this.version;
		this.pending = this.pending
			.catch(() => {})
			.then(async () => {
				if (version !== this.version) return;
				const fingerprint = await canvasFingerprint(value);
				if (fingerprint === this.acknowledged) {
					await this.storage.discard(this.identity.key);
					if (version === this.version) {
						this.saved = true;
						this.locallySaved = true;
						this.error = null;
					}
				} else {
					await this.storage.persist({
						...this.identity,
						payload: value,
						baseVersion: this.acknowledged,
						status: "unsaved",
						updatedAt: new Date().toISOString(),
						writeId: crypto.randomUUID(),
					});
					if (version === this.version) {
						this.locallySaved = true;
						this.error = null;
					}
				}
				this.publish();
			})
			.catch((error) => {
				this.error = error;
				this.locallySaved = false;
				this.publish();
				throw error;
			});
		void this.pending.catch(() => {});
	}
	acknowledge = (fingerprint: string) => {
		this.acknowledged = fingerprint;
		this.capture();
		if (!this.saved) this.queueSave();
	};
	pause = () => {
		this.paused = true;
		this.reconnect();
		this.publish();
	};
	resume = () => {
		this.paused = false;
		this.reconnect();
		this.publish();
	};
	flushLocal = async () => {
		this.capture();
		if (this.error) this.queueSave();
		await this.pending;
	};
	flushServer = async () => {
		await this.flushLocal();
		const deadline = Date.now() + 3000;
		while (!this.saved && !this.paused && Date.now() < deadline)
			await new Promise((r) => setTimeout(r, 30));
		return this.saved;
	};
	dispose() {
		this.capture();
		this.unregister();
		void this.pending.catch(() => {});
	}
}
