"use client";

import { createContext, type ReactNode, useContext } from "react";

export type AppSessionUser = {
	id: string;
	name: string;
	email: string;
	image: string | null;
};

export type AppWorkspaceSummary = {
	id: string;
	name: string;
	logo: string | null;
};

export type AppSessionValue = {
	user: AppSessionUser;
	activeWorkspaceId: string | null;
	workspaceRole: string | null;
	workspaces: AppWorkspaceSummary[];
	isAdmin: boolean;
};

const AppSessionContext = createContext<AppSessionValue | null>(null);

export function AppSessionProvider({
	value,
	children,
}: {
	value: AppSessionValue;
	children: ReactNode;
}) {
	return (
		<AppSessionContext.Provider value={value}>
			{children}
		</AppSessionContext.Provider>
	);
}

export function useAppSession(): AppSessionValue | null {
	return useContext(AppSessionContext);
}

export function useCurrentUser(): AppSessionUser | null {
	return useAppSession()?.user ?? null;
}
