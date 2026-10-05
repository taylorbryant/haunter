"use client";

import NextLink from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useMemo, type ComponentProps } from "react";

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
