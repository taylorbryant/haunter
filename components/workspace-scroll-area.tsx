"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { installWorkspaceScrollRestoration } from "@/client/workspace-scroll-restoration";

export function WorkspaceScrollArea({ children }: { children: ReactNode }) {
	const area = useRef<HTMLDivElement>(null);
	const restoration =
		useRef<ReturnType<typeof installWorkspaceScrollRestoration>>(null);
	const pathname = usePathname();
	const search = useSearchParams().toString();
	const route = pathname + (search ? `?${search}` : "");
	useLayoutEffect(() => {
		if (!area.current) return;
		const controller = installWorkspaceScrollRestoration(area.current);
		restoration.current = controller;
		return () => controller.dispose();
	}, []);
	useLayoutEffect(() => {
		if (route) restoration.current?.sync();
	}, [route]);
	return (
		<div
			ref={area}
			data-app-scroll-root=""
			data-scroll-route={route}
			className="min-h-0 min-w-0 flex-1 overflow-auto"
		>
			{children}
		</div>
	);
}
