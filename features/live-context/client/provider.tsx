"use client";

import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { usePathname } from "next/navigation";
import { apiClient } from "@/client";
import { getBrowserSessionRecovery } from "@/client/session-recovery";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { publishLiveContext } from "../contracts";
import { contextRoute, LiveContextTracker } from "./tracker";

const LiveContext = createContext<LiveContextTracker | null>(null);
export const useLiveContext = () => useContext(LiveContext);

export function LiveContextProvider({
	userId,
	activeWorkspaceId,
	children,
}: {
	userId: string;
	activeWorkspaceId: string | null;
	children: ReactNode;
}) {
	const pathname = usePathname();
	const requestsEnabled = useProtectedRequestsEnabled();
	const [tracker] = useState(
		() =>
			new LiveContextTracker(userId, async (body) => {
				const recovery = getBrowserSessionRecovery();
				if (
					!recovery ||
					recovery.userId !== userId ||
					recovery.getSnapshot().blocked
				)
					return;
				await apiClient
					.endpoint(publishLiveContext)
					.call({ body, signal: AbortSignal.timeout(5_000) });
			}),
	);
	const route = contextRoute(pathname);
	const enabled = requestsEnabled && route?.workspaceId === activeWorkspaceId;

	useEffect(() => {
		tracker.navigate(enabled ? contextRoute(pathname) : null);
		if (!enabled) void tracker.flush();
	}, [tracker, pathname, enabled]);

	useEffect(() => {
		if (!enabled) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		tracker.onChange = () => {
			if (timer) return;
			timer = setTimeout(() => {
				timer = undefined;
				void tracker.flush();
			}, 300);
		};
		const presence = () =>
			tracker.presence(
				document.visibilityState === "visible",
				document.hasFocus(),
			);
		const interact = (event: Event) => {
			// Browser blur/visibility changes retain the last meaningful selection.
			// Actual interaction elsewhere in Haunter clears the active embedded canvas.
			if (
				event.target instanceof Element &&
				!event.target.closest("[data-live-context-canvas]")
			)
				tracker.clearCanvas();
		};
		const hide = () => {
			tracker.withdraw();
			void tracker.flush();
		};
		const show = () => {
			tracker.navigate(null);
			tracker.navigate(contextRoute(pathname));
			presence();
			void tracker.flush();
		};
		presence();
		// Defer the first report until parent authentication effects are installed.
		tracker.heartbeat();
		const interval = setInterval(() => {
			presence();
			tracker.heartbeat();
			void tracker.flush();
		}, 15_000);
		window.addEventListener("focus", presence);
		window.addEventListener("blur", presence);
		window.addEventListener("pagehide", hide);
		window.addEventListener("pageshow", show);
		document.addEventListener("visibilitychange", presence);
		document.addEventListener("pointerdown", interact, true);
		document.addEventListener("focusin", interact, true);
		return () => {
			tracker.onChange = undefined;
			if (timer) clearTimeout(timer);
			clearInterval(interval);
			window.removeEventListener("focus", presence);
			window.removeEventListener("blur", presence);
			window.removeEventListener("pagehide", hide);
			window.removeEventListener("pageshow", show);
			document.removeEventListener("visibilitychange", presence);
			document.removeEventListener("pointerdown", interact, true);
			document.removeEventListener("focusin", interact, true);
		};
	}, [tracker, enabled, pathname]);

	return (
		<LiveContext.Provider value={enabled ? tracker : null}>
			{children}
		</LiveContext.Provider>
	);
}
