"use client";

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import {
	listDocumentRecoveryCopies,
	type LocalRecoveryCopy,
	type RecoveryReadCache,
} from "./local-store";

import {
	pageDocumentStorageKey,
	type PageRecoveryIdentity,
} from "./recovery-files";

export function usePageRecoveries(options: PageRecoveryIdentity | null) {
	const key = options ? pageDocumentStorageKey(options) : null;
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<{
		key: string | null;
		copies: LocalRecoveryCopy[];
		error: string | null;
	}>({ key: null, copies: [], error: null });
	// biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly recreates a failed live-query subscription
	useEffect(() => {
		if (!key) return;
		const cache: RecoveryReadCache = new Map();
		const subscription = liveQuery(() =>
			listDocumentRecoveryCopies(key, cache),
		).subscribe({
			next: (copies) => setState({ key, copies, error: null }),
			error: () =>
				setState((previous) => ({
					key,
					copies: previous.key === key ? previous.copies : [],
					error:
						"Copies on this device could not be read. Keep this browser open and try again.",
				})),
		});
		return () => subscription.unsubscribe();
	}, [key, attempt]);
	// Never expose another account or page's copies during an effect handoff.
	return {
		...(state.key === key ? state : { key, copies: [], error: null }),
		loading: key !== null && state.key !== key,
		retry: () => {
			// Keep the last readable copies and error visible until a read succeeds.
			setAttempt((value) => value + 1);
		},
	};
}
