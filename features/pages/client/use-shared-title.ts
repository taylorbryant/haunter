"use client";

import { useCallback, useEffect, useState } from "react";
import type { CollabRoom } from "@/features/collab/client/session";
import { pageTitleName } from "@/features/documents/model";
import { updateSharedText } from "@/features/documents/y-text";

/**
 * The page title as a shared Y.Text in the authoritative page document.
 * SQLite is an asynchronous projection used for navigation and recovery.
 *
 * Title changes preserve the unchanged prefix and suffix so Yjs can merge
 * ordinary concurrent typing at character granularity.
 */
export function useSharedTitle(
	room: CollabRoom | null,
	generation: string | null,
) {
	const [sharedTitle, setSharedTitle] = useState<string | null>(null);

	useEffect(() => {
		if (!room) return;
		const yTitle = room.doc.getText(pageTitleName(generation));
		const observer = () => setSharedTitle(yTitle.toString());
		yTitle.observe(observer);
		observer();
		return () => {
			yTitle.unobserve(observer);
			setSharedTitle(null);
		};
	}, [room, generation]);

	const pushTitle = useCallback(
		(next: string) => {
			if (!room) return;
			const yTitle = room.doc.getText(pageTitleName(generation));
			room.doc.transact(() => {
				updateSharedText(yTitle, next);
			});
		},
		[room, generation],
	);

	return { sharedTitle, pushTitle };
}
