"use client";

import { useRef, useState } from "react";
import { userErrorMessage } from "@/client/error-feedback";
import { useOpenRecoveryPage } from "./use-open-recovery-page";

export type RecoverySource = {
	recoveryDownload: (generation: number) => Promise<string>;
};

/** Own this in the history dialog, above its responsive Drawer/Dialog branches. */
export function useRecoveryCopyActions(
	workspaceId: string,
	source: RecoverySource,
) {
	const openRecoveryPage = useOpenRecoveryPage(workspaceId, source);
	const busy = useRef(false);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<{
		generation: number;
		message: string;
	} | null>(null);
	async function act(generation: number, action: () => Promise<void>) {
		if (busy.current) return;
		busy.current = true;
		setWorking(true);
		setError(null);
		try {
			await action();
		} catch (error) {
			setError({
				generation,
				message: `${userErrorMessage(error, "The recovery copy could not be opened.")} Your copy is still saved in this browser.`,
			});
		} finally {
			busy.current = false;
			setWorking(false);
		}
	}
	return {
		working,
		error,
		open: (generation: number) =>
			act(generation, () => openRecoveryPage(generation)),
		download: (generation: number) =>
			act(generation, async () => {
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
