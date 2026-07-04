"use client";

import { createContext, useContext } from "react";

/**
 * The share token of the public page being rendered, or null inside the
 * normal (authenticated) app. Interactive blocks that fetch their own data
 * (canvases) read this to use the share-scoped public endpoints instead of
 * the member ones.
 */
const SharedPageTokenContext = createContext<string | null>(null);

export function SharedPageTokenProvider({
	token,
	children,
}: {
	token: string;
	children: React.ReactNode;
}) {
	return (
		<SharedPageTokenContext.Provider value={token}>
			{children}
		</SharedPageTokenContext.Provider>
	);
}

export function useSharedPageToken(): string | null {
	return useContext(SharedPageTokenContext);
}
