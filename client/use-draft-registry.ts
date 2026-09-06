"use client";

import { useSyncExternalStore } from "react";
import { draftRegistry } from "./draft-registry";

export function useDraftRegistry() {
	useSyncExternalStore(
		draftRegistry.subscribe,
		draftRegistry.getSnapshot,
		() => 0,
	);
	return draftRegistry;
}
