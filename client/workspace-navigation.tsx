"use client";

import NextLink from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	type ComponentProps,
} from "react";

/** The shared workspace UI can navigate inside an embedded React surface. */
export const WorkspaceNavigationContext = createContext<{
	pathname: string;
	search?: string;
	navigate(path: string): Promise<void>;
} | null>(null);

export function useWorkspacePathname() {
	const pathname = usePathname();
	return useContext(WorkspaceNavigationContext)?.pathname ?? pathname;
}

export function useWorkspaceSearchParams() {
	const params = useSearchParams();
	const navigation = useContext(WorkspaceNavigationContext);
	return useMemo(
		() => (navigation ? new URLSearchParams(navigation.search ?? "") : params),
		[navigation, params],
	);
}

/** For client-owned filters; keeps the current screen mounted without a server navigation. */
export function useReplaceWorkspaceSearchParams() {
	const navigation = useContext(WorkspaceNavigationContext);
	return useCallback(
		(update: (params: URLSearchParams) => void) => {
			// Read the current URL at click time so rapid filter changes compose.
			const params = new URLSearchParams(
				navigation ? navigation.search : window.location.search,
			);
			update(params);
			const pathname = navigation?.pathname ?? window.location.pathname;
			const query = params.toString();
			const path = query ? `${pathname}?${query}` : pathname;
			if (navigation) {
				// Embedded navigation still owns its save guard and view context.
				void navigation.navigate(path);
			} else {
				// Next syncs native history updates with useSearchParams. Pass fresh
				// state so Next does not mistake this for one of its internal writes.
				window.history.replaceState(null, "", path + window.location.hash);
			}
		},
		[navigation],
	);
}

export function WorkspaceLink({
	href,
	onClick,
	prefetch,
	replace,
	scroll,
	...props
}: ComponentProps<typeof NextLink>) {
	const navigation = useContext(WorkspaceNavigationContext);
	if (!navigation || typeof href !== "string")
		return (
			<NextLink
				{...props}
				href={href}
				onClick={onClick}
				prefetch={prefetch}
				replace={replace}
				scroll={scroll}
			/>
		);
	return (
		<a
			{...props}
			href={href}
			onClick={(event) => {
				onClick?.(event);
				if (event.defaultPrevented || event.button !== 0) return;
				event.preventDefault();
				void navigation.navigate(href);
			}}
		/>
	);
}
