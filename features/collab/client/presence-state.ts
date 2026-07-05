"use client";

import { useSyncExternalStore } from "react";

export type PresencePeer = { name: string; color: string };

/**
 * Tiny external store so the header can show who else is in the current
 * page without threading the collab room through the layout boundary.
 * Mirrors the save-state store pattern.
 */
let peers: PresencePeer[] = [];
const listeners = new Set<() => void>();
const EMPTY: PresencePeer[] = [];

export function setCollabPresence(next: PresencePeer[]) {
	if (
		peers.length === next.length &&
		peers.every(
			(peer, index) =>
				peer.name === next[index]?.name && peer.color === next[index]?.color,
		)
	) {
		return;
	}
	peers = next;
	for (const listener of listeners) {
		listener();
	}
}

export function useCollabPresence(): PresencePeer[] {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => peers,
		() => EMPTY,
	);
}
