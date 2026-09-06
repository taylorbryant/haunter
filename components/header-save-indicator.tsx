"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { useDraftRegistry } from "@/client/use-draft-registry";
import { usePageSaveState } from "@/features/pages/client/save-state";
import { useCachedPage } from "@/features/pages/client/use-cached-page";
import { formatEditedAt } from "@/features/pages/lib/format-edited-at";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";

const PageHistoryDialog = dynamic(
	() =>
		import("@/features/pages/components/page-history-dialog").then(
			(mod) => mod.PageHistoryDialog,
		),
	{ ssr: false },
);

/** Re-render on a fixed cadence so a relative-time label stays current. */
function useNow(intervalMs: number) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(timer);
	}, [intervalMs]);
	return now;
}

export function HeaderSaveIndicator() {
	const pathname = usePathname();
	const fallbackState = usePageSaveState();
	const registry = useDraftRegistry();
	const now = useNow(30_000);
	const canEdit = useCanEditWorkspace();
	const [historyOpen, setHistoryOpen] = useState(false);

	const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const page = useCachedPage(pageId);

	if (pageId === null) return null;
	const drafts = registry
		.entries()
		.filter(
			(entry) =>
				entry.identity.resourceId === pageId &&
				entry.identity.resourceType !== "canvas",
		)
		.map((entry) => entry.getSnapshot());
	const state = drafts.length
		? drafts.some((draft) =>
				["storage-error", "sync-error", "conflict", "invalid"].includes(
					draft.status,
				),
			)
			? "error"
			: drafts.some(
						(draft) =>
							draft.locallySaved === false ||
							["pending", "syncing"].includes(draft.status),
					)
				? "saving"
				: drafts.some((draft) => draft.remotePaused && draft.dirty)
					? "paused"
					: "saved"
		: fallbackState;

	let label: string | null;
	if (state === "paused") {
		label = "Saved in this browser";
	} else if (state === "saving" || state === "pending") {
		label = "Saving…";
	} else if (state === "error") {
		label = "Save failed";
	} else if (page) {
		label = formatEditedAt(page.updatedAt, now);
	} else {
		// Page still loading; the editor shows its own skeleton.
		label = null;
	}

	if (label === null) return null;

	const className =
		"ml-auto shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums";
	const canOpenHistory = page !== undefined && canEdit && synced;

	if (!canOpenHistory) {
		return <span className={className}>{label}</span>;
	}

	return (
		<>
			<button
				type="button"
				className={`keyboard-focus-ring ${className} inline-flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-sm bg-transparent p-0 transition-colors hover:text-foreground hover:underline [--keyboard-focus-ring-size:2px]`}
				aria-label={`Open page history. ${label}`}
				aria-haspopup="dialog"
				onClick={() => setHistoryOpen(true)}
			>
				{label}
			</button>
			{historyOpen ? (
				<PageHistoryDialog pageId={pageId} onOpenChange={setHistoryOpen} />
			) : null}
		</>
	);
}
