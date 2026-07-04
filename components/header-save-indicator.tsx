"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getPageQueryOptions } from "@/features/pages/client/queries";
import { usePageSaveState } from "@/features/pages/client/save-state";
import { formatEditedAt } from "@/features/pages/lib/format-edited-at";

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
	const state = usePageSaveState();
	const now = useNow(30_000);

	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;
	const pageQuery = useQuery({
		...getPageQueryOptions(pageId ?? ""),
		enabled: pageId !== null,
	});

	if (pageId === null) return null;

	let label: string | null;
	if (state === "saving" || state === "pending") {
		label = "Saving…";
	} else if (state === "error") {
		label = "Save failed";
	} else if (pageQuery.data) {
		label = formatEditedAt(pageQuery.data.updatedAt, now);
	} else {
		// Page still loading; the editor shows its own skeleton.
		label = null;
	}

	if (label === null) return null;

	return (
		<span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums">
			{label}
		</span>
	);
}
