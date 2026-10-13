"use client";

import { useRef, useState } from "react";
import { userErrorMessage } from "@/client/error-feedback";
import { useOpenRecoveryPage } from "./use-open-recovery-page";

export type RecoverySource = {
	recoveryDownload: (generation: number) => Promise<string>;
};

type RecoveryAction = { kind: "open" | "download"; generation: number };

/** Own this in the history dialog, above its responsive Drawer/Dialog branches. */
export function useRecoveryCopyActions(
	workspaceId: string,
	source: RecoverySource,
) {
	const openRecoveryPage = useOpenRecoveryPage(workspaceId, source);
	const busy = useRef(false);
	const [activeAction, setActiveAction] = useState<RecoveryAction | null>(null);
	const [error, setError] = useState<{
		generation: number;
		message: string;
	} | null>(null);
	async function act(
		generation: number,
		kind: RecoveryAction["kind"],
		action: () => Promise<void>,
	) {
		if (busy.current) return;
		busy.current = true;
		setActiveAction({ kind, generation });
		setError(null);
		try {
			await action();
		} catch (error) {
			const fallback =
				kind === "open"
					? "The recovery copy could not be opened."
					: "The recovery copy could not be downloaded.";
			setError({
				generation,
				message: `${userErrorMessage(error, fallback)} Your copy is still saved in this browser.`,
			});
		} finally {
			busy.current = false;
			setActiveAction(null);
		}
	}
	return {
		working: activeAction !== null,
		activeAction,
		error,
		open: (generation: number) =>
			act(generation, "open", () => openRecoveryPage(generation)),
		download: (generation: number) =>
			act(generation, "download", async () => {
				const file = await source.recoveryDownload(generation);
				const url = URL.createObjectURL(
					new Blob([file], { type: "application/json" }),
				);
				const link = document.createElement("a");
				link.href = url;
				link.download = "haunter-previous-copy.json";
				link.hidden = true;
				document.body.append(link);
				link.click();
				link.remove();
				setTimeout(() => URL.revokeObjectURL(url), 1000);
			}),
	};
}
