"use client";

import { useCollabPresence } from "@/features/collab/client/presence-state";

/**
 * Small colored-initial chips for the other people in the current page,
 * shown in the app header beside the "Edited X ago" label.
 */
export function HeaderPresence() {
	const peers = useCollabPresence();

	if (peers.length === 0) return null;

	return (
		<div className="flex shrink-0 items-center -space-x-1">
			{peers.slice(0, 5).map((peer) => (
				<span
					key={peer.name}
					title={peer.name}
					className="flex size-5 items-center justify-center rounded-full text-[9px] text-white leading-none ring-2 ring-background"
					style={{ backgroundColor: peer.color }}
				>
					{peer.name.trim().slice(0, 2).toUpperCase()}
				</span>
			))}
		</div>
	);
}
