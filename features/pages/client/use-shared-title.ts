"use client";

import { useCallback, useEffect, useState } from "react";
import type { CollabRoom } from "@/features/collab/client/liveblocks";

/**
 * The page title as a shared Y.Text in the page's collaboration doc. The
 * database stays the durable copy (each typing peer still PATCHes it);
 * this only makes the title update live across open sessions.
 *
 * Concurrent title typing is last-write-wins per keystroke (each local
 * change replaces the whole Y.Text) — good enough for a one-line title,
 * and far simpler than character merging.
 */
export function useSharedTitle(
	room: CollabRoom | null,
	/** Null while the page is still loading — seeding waits for the value. */
	dbTitle: string | null,
) {
	const [sharedTitle, setSharedTitle] = useState<string | null>(null);
	const dbTitleLoaded = dbTitle !== null;

	useEffect(() => {
		if (!room) return;
		const yTitle = room.doc.getText("title");
		const observer = () => setSharedTitle(yTitle.toString());
		yTitle.observe(observer);
		observer();
		return () => {
			yTitle.unobserve(observer);
			setSharedTitle(null);
		};
	}, [room]);

	// Seed a fresh room's title from the database exactly once. An empty
	// title is a legitimate state, so the flag — not emptiness — is the
	// guard here.
	// biome-ignore lint/correctness/useExhaustiveDependencies: dbTitle is only the one-time seed value; reseeding on later PATCH echoes would fight live edits
	useEffect(() => {
		if (!room || !dbTitleLoaded) return;
		const yTitle = room.doc.getText("title");
		const meta = room.doc.getMap<boolean>("haunter-meta");
		if (meta.get("titleSeeded") !== true) {
			room.doc.transact(() => {
				meta.set("titleSeeded", true);
				if (yTitle.length === 0 && dbTitle) {
					yTitle.insert(0, dbTitle);
				}
			});
		}
	}, [room, dbTitleLoaded]);

	const pushTitle = useCallback(
		(next: string) => {
			if (!room) return;
			const yTitle = room.doc.getText("title");
			room.doc.transact(() => {
				yTitle.delete(0, yTitle.length);
				yTitle.insert(0, next);
			});
		},
		[room],
	);

	return { sharedTitle, pushTitle };
}
