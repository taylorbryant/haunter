"use client";

import { usePathname } from "next/navigation";
import { usePageSaveState } from "@/features/pages/client/save-state";

export function HeaderSaveIndicator() {
	const pathname = usePathname();
	const state = usePageSaveState();

	if (!/\/p\/[^/]+/.test(pathname)) return null;

	return (
		<span className="ml-auto text-muted-foreground text-xs tabular-nums">
			{state === "saved"
				? "Saved"
				: state === "error"
					? "Save failed"
					: "Saving…"}
		</span>
	);
}
