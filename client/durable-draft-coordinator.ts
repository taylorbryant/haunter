"use client";

export type LocalDraftFlusher = {
	readonly key: string;
	flushLocal(): Promise<void>;
};

class DurableDraftCoordinator {
	private readonly active = new Map<
		string,
		{ draft: LocalDraftFlusher; registration: symbol }
	>();

	register(draft: LocalDraftFlusher) {
		const registration = Symbol(draft.key);
		this.active.set(draft.key, { draft, registration });
		return () => {
			// Keep an unmounted writer visible to the root recovery barrier until its
			// final local transaction settles. A failed writer remains registered so
			// navigation stays blocked; remounting the same resource replaces it.
			void draft.flushLocal().then(
				() => {
					if (this.active.get(draft.key)?.registration === registration) {
						this.active.delete(draft.key);
					}
				},
				() => undefined,
			);
		};
	}

	async flushAllLocal() {
		await Promise.all(
			Array.from(this.active.values(), ({ draft }) => draft.flushLocal()),
		);
	}
}

export const durableDraftCoordinator = new DurableDraftCoordinator();
