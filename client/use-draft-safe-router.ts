"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { draftRegistry } from "./draft-registry";
import { getBrowserSessionRecovery } from "./session-recovery";

/** Only local durability is required for navigation; remote saving can resume later. */
export async function navigateWithDrafts(navigate: () => void) {
	if (!draftRegistry.hasVolatileChanges()) {
		navigate();
		return true;
	}
	if (!(await draftRegistry.flushLocal())) return false;
	navigate();
	return true;
}

/** Cover command-driven navigation as well as the anchor lifecycle guard. */
export function useDraftSafeRouter() {
	const router = useRouter();
	return useMemo(
		() => ({
			...router,
			push: (...args: Parameters<typeof router.push>) => {
				void navigateWithDrafts(() => router.push(...args));
			},
			replace: (...args: Parameters<typeof router.replace>) => {
				void navigateWithDrafts(() => router.replace(...args));
			},
			back: () => {
				void navigateWithDrafts(() => router.back());
			},
			forward: () => {
				void navigateWithDrafts(() => router.forward());
			},
			refresh: () => {
				if (getBrowserSessionRecovery()?.getSnapshot().blocked) return;
				void navigateWithDrafts(() => router.refresh());
			},
		}),
		[router],
	);
}
