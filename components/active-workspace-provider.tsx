"use client";

import { createContext, type ReactNode, useContext } from "react";

/**
 * The active workspace id the SERVER saw when it rendered this document —
 * a hydration hint, not live state. On a cold load the workspace layout can
 * trust it and render content immediately instead of blanking the screen
 * for a client round trip that will confirm the same value. After
 * hydration the client-side org store is the source of truth (this value
 * goes stale across soft navigations, since layouts don't re-render).
 */
const ActiveWorkspaceHintContext = createContext<string | null>(null);

export function ActiveWorkspaceHintProvider({
	value,
	children,
}: {
	value: string | null;
	children: ReactNode;
}) {
	return (
		<ActiveWorkspaceHintContext.Provider value={value}>
			{children}
		</ActiveWorkspaceHintContext.Provider>
	);
}

export function useActiveWorkspaceHint() {
	return useContext(ActiveWorkspaceHintContext);
}
