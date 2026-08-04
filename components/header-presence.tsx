"use client";

import { BotIcon } from "lucide-react";
import { useCollabPresence } from "@/features/collab/client/presence-state";

const AGENT_STATUS_LABEL = {
	reading: "is reading",
	editing: "is editing",
	creating: "is creating",
	organizing: "is organizing",
	finished: "finished",
} as const;

/**
 * Small colored-initial chips for the other people in the current page,
 * shown in the app header beside the "Edited X ago" label.
 */
export function HeaderPresence() {
	const peers = useCollabPresence();

	if (peers.length === 0) return null;

	return (
		<div className="flex shrink-0 items-center gap-1">
			{[...peers]
				.sort((a, b) => Number(b.kind === "agent") - Number(a.kind === "agent"))
				.slice(0, 5)
				.map((peer) => {
					const label =
						peer.kind === "agent" && peer.status
							? `${peer.name} ${AGENT_STATUS_LABEL[peer.status]}`
							: peer.name;
					return peer.kind === "agent" ? (
						<span
							key={peer.id}
							title={label}
							className="flex h-6 items-center gap-1.5 rounded-full border border-border bg-muted px-1.5 text-muted-foreground text-xs"
						>
							<BotIcon
								aria-hidden="true"
								className="size-3.5"
								style={{ color: peer.color }}
							/>
							<span className="sr-only">{label}</span>
							<span
								aria-hidden="true"
								className="hidden max-w-40 truncate sm:inline"
							>
								{label}
							</span>
						</span>
					) : (
						<span
							key={peer.id}
							title={label}
							className="flex size-5 items-center justify-center rounded-full text-[9px] text-white leading-none ring-2 ring-background"
							style={{ backgroundColor: peer.color }}
						>
							{peer.name.trim().slice(0, 2).toUpperCase()}
						</span>
					);
				})}
		</div>
	);
}
