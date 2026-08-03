"use client";

import { useCallback, useEffect, useState } from "react";
import type { CollabRoom } from "@/features/collab/client/session";
import { pageTitleName } from "@/features/documents/model";

/**
 * The page title as a shared Y.Text in the authoritative page document.
 * SQLite is an asynchronous projection used for navigation and recovery.
 *
 * Concurrent title typing is last-write-wins per keystroke (each local
 * change replaces the whole Y.Text) — good enough for a one-line title,
 * and far simpler than character merging.
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

	const replaceTitle = useCallback(
		(next: string) => {
			if (!room) return null;
			const yTitle = room.doc.getText(pageTitleName(generation));
			const previous = yTitle.toString();
			room.doc.transact(() => {
				yTitle.delete(0, yTitle.length);
				yTitle.insert(0, next);
			});
			return previous;
		},
		[room, generation],
	);
	const replaceTitleIfCurrent = useCallback(
		(expected: string, next: string) => {
			if (!room) return false;
			const yTitle = room.doc.getText(pageTitleName(generation));
			if (yTitle.toString() !== expected) return false;
			room.doc.transact(() => {
				yTitle.delete(0, yTitle.length);
				yTitle.insert(0, next);
			});
			return true;
		},
		[room, generation],
	);
	const pushTitle = useCallback(
		(next: string) => {
			replaceTitle(next);
		},
		[replaceTitle],
	);

	return { sharedTitle, pushTitle, replaceTitle, replaceTitleIfCurrent };
}
