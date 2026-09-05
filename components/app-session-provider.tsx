"use client";

import {
	createContext,
	type ReactNode,
	useContext,
	useState,
	useEffect,
	useCallback,
} from "react";

import { SessionRecoveryProvider } from "./session-recovery-provider";

export type AppSessionUser = {
	id: string;
	name: string;
	email: string;
	image: string | null;
};

export type AppSessionValue = {
	user: AppSessionUser;
	activeWorkspaceId: string | null;
	workspaceRole: string | null;
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
	const [session, setSession] = useState(value);
	useEffect(() => setSession(value), [value]);
	const onVerified = useCallback(
		(verified: {
			activeWorkspaceId: string | null;
			workspaceRole: string | null;
		}) => {
			setSession((current) =>
				current.activeWorkspaceId === verified.activeWorkspaceId &&
				current.workspaceRole === verified.workspaceRole
					? current
					: { ...current, ...verified },
			);
		},
		[],
	);
	return (
		<AppSessionContext.Provider value={session}>
			<SessionRecoveryProvider
				key={value.user.id}
				initial={value}
				onVerified={onVerified}
			>
				{children}
			</SessionRecoveryProvider>
		</AppSessionContext.Provider>
	);
}

export function useAppSession(): AppSessionValue | null {
	return useContext(AppSessionContext);
}

export function useCurrentUser(): AppSessionUser | null {
	return useAppSession()?.user ?? null;
}
