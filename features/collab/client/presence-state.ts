"use client";

import { useSyncExternalStore } from "react";
import type { AgentPresenceStatus } from "@/features/agents/ports";
import { cursorColorFor } from "@/features/collab/lib/room";

export type PresencePeer = {
	id: string;
	name: string;
	color: string;
	kind: "human" | "agent";
	status?: AgentPresenceStatus;
};

type RoomOther = {
	connectionId?: number;
	id?: string;
	info?: unknown;
	presence?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function agentStatus(value: unknown): AgentPresenceStatus | undefined {
	return value === "reading" ||
		value === "editing" ||
		value === "creating" ||
		value === "organizing" ||
		value === "finished"
		? value
		: undefined;
}

/** Convert Liveblocks' native room users into safe, deduplicated header peers. */
export function presencePeersFromOthers(
	others: readonly RoomOther[],
): PresencePeer[] {
	const peers = new Map<string, PresencePeer>();
	for (const other of others) {
		const id =
			typeof other.id === "string" && other.id
				? other.id
				: `connection:${other.connectionId ?? "unknown"}`;
		const info = record(other.info);
		const presence = record(other.presence);
		const status = agentStatus(presence?.status);
		const kind =
			id.startsWith("agent:") && presence?.kind === "agent" && status
				? "agent"
				: "human";
		const name =
			typeof info?.name === "string" && info.name.trim()
				? info.name.trim()
				: kind === "agent"
					? "AI agent"
					: "Collaborator";
		const color =
			typeof info?.color === "string" && info.color
				? info.color
				: cursorColorFor(id);
		peers.set(id, {
			id,
			name,
			color,
			kind,
			...(kind === "agent" ? { status } : {}),
		});
	}
	return [...peers.values()];
}

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
				peer.id === next[index]?.id &&
				peer.name === next[index]?.name &&
				peer.color === next[index]?.color &&
				peer.kind === next[index]?.kind &&
				peer.status === next[index]?.status,
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
