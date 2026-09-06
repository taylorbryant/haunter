import type {
	DurableDraftIdentity,
	DurableDraftSnapshot,
} from "./durable-drafts";

export type RegisteredDraft = {
	readonly identity: DurableDraftIdentity;
	getSnapshot(): DurableDraftSnapshot<unknown>;
	subscribe(listener: () => void): () => void;
	pause(): void;
	resume(): void;
	flushLocal(): Promise<void>;
	flushServer(): Promise<boolean>;
};

export class DraftRegistry {
	private drafts = new Set<RegisteredDraft>();
	private listeners = new Set<() => void>();
	private version = 0;
	private notificationPending = false;
	private pausedUsers = new Set<string>();
	getSnapshot = () => this.version;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private changed = () => {
		if (this.notificationPending) return;
		this.notificationPending = true;
		// Editors own their live values. Batch status changes outside their render
		// callbacks, and never rerender the app for every character in a draft.
		queueMicrotask(() => {
			this.notificationPending = false;
			this.version++;
			for (const listener of this.listeners) listener();
		});
	};
	register(draft: RegisteredDraft) {
		this.drafts.add(draft);
		if (this.pausedUsers.has(draft.identity.userId)) draft.pause();
		const signature = () => {
			const value = draft.getSnapshot();
			return `${value.status}:${value.dirty}:${value.locallySaved}:${value.remotePaused}`;
		};
		let previous = signature();
		const unsubscribe = draft.subscribe(() => {
			const next = signature();
			if (next === previous) return;
			previous = next;
			this.changed();
		});
		this.changed();
		return () => {
			unsubscribe();
			this.drafts.delete(draft);
			this.changed();
		};
	}
	entries(userId?: string) {
		return [...this.drafts].filter(
			(draft) => !userId || draft.identity.userId === userId,
		);
	}
	setPaused(userId: string, paused: boolean) {
		if (paused) this.pausedUsers.add(userId);
		else this.pausedUsers.delete(userId);
		for (const draft of this.entries(userId)) {
			if (paused) draft.pause();
			else draft.resume();
		}
	}
	hasVolatileChanges(userId?: string) {
		return this.entries(userId).some((draft) => {
			const snapshot = draft.getSnapshot();
			return (
				snapshot.locallySaved === false &&
				(snapshot.dirty || snapshot.status === "storage-error")
			);
		});
	}
	async flushLocal(userId?: string) {
		const results = await Promise.allSettled(
			this.entries(userId).map((draft) => draft.flushLocal()),
		);
		return (
			results.every((result) => result.status === "fulfilled") &&
			!this.hasVolatileChanges(userId)
		);
	}
}

export const draftRegistry = new DraftRegistry();
