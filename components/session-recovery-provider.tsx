"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { downloadRecoveryDrafts } from "@/client/draft-export";
import { installDraftLifecycle } from "@/client/draft-lifecycle";
import { draftRegistry } from "@/client/draft-registry";
import {
	installSessionRecovery,
	SessionRecovery,
	type SessionSnapshot,
} from "@/client/session-recovery";
import {
	SESSION_CHANGE_EVENT,
	SESSION_CHANGE_KEY,
} from "@/client/session-signals";
import { verifyBrowserSession } from "@/client/session-verification";
import { useDraftRegistry } from "@/client/use-draft-registry";
import { canEditContent } from "@/lib/org-roles";
import type { AppSessionValue } from "./app-session-provider";
import { SessionRecoveryDialog } from "./auth/session-recovery-dialog";
import { Button } from "./ui/button";

const RecoveryContext = createContext<SessionSnapshot | null>(null);
export function useProtectedRequestsEnabled() {
	return !useContext(RecoveryContext)?.blocked;
}

export function SessionRecoveryProvider({
	initial,
	onVerified,
	children,
}: {
	initial: AppSessionValue;
	onVerified(value: {
		activeWorkspaceId: string | null;
		workspaceRole: string | null;
	}): void;
	children: ReactNode;
}) {
	const latest = useRef(initial);
	latest.current = initial;
	const onVerifiedRef = useRef(onVerified);
	onVerifiedRef.current = onVerified;
	const queryClient = useQueryClient();
	const [recovery] = useState(
		() =>
			new SessionRecovery(
				initial.user.id,
				(signal, recover) => {
					const workspaceId =
						window.location.pathname.match(/^\/w\/([^/]+)/)?.[1] ??
						latest.current.activeWorkspaceId;
					return verifyBrowserSession({
						userId: initial.user.id,
						workspaceId,
						requireEdit:
							canEditContent(latest.current.workspaceRole) &&
							draftRegistry
								.entries(initial.user.id)
								.some((draft) => draft.identity.workspaceId === workspaceId),
						signal,
						recover,
					});
				},
				{ workspaceId: initial.activeWorkspaceId, role: initial.workspaceRole },
			),
	);
	const state = useSyncExternalStore(
		recovery.subscribe,
		recovery.getSnapshot,
		recovery.getSnapshot,
	);
	const registry = useDraftRegistry();
	const [dialogOpen, setDialogOpen] = useState(false);
	const frame = useRef<HTMLDivElement>(null);
	const banner = useRef<HTMLDivElement>(null);
	const focusBookmark = useRef<{
		element: HTMLElement | null;
		range: Range | null;
	} | null>(null);
	const rememberFocus = () => {
		const selection = window.getSelection();
		const range = selection?.rangeCount
			? selection.getRangeAt(0).cloneRange()
			: null;
		const node = range?.startContainer;
		const editor = (
			node instanceof Element ? node : node?.parentElement
		)?.closest<HTMLElement>("[contenteditable=true]");
		focusBookmark.current = {
			element:
				editor ??
				(document.activeElement instanceof HTMLElement
					? document.activeElement
					: null),
			range: editor ? range : null,
		};
	};
	const restoreFocus = () => {
		if (recovery.getSnapshot().contentAccess !== "available") return;
		const bookmark = focusBookmark.current;
		focusBookmark.current = null;
		if (!bookmark?.element?.isConnected) return;
		bookmark.element.focus({ preventScroll: true });
		if (bookmark.range?.startContainer.isConnected) {
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(bookmark.range);
		}
	};
	const ownerId = initial.user.id;
	useEffect(() => {
		const uninstall = installSessionRecovery(recovery);
		let previouslyBlocked = false;
		const synchronize = () => {
			const current = recovery.getSnapshot();
			draftRegistry.setPaused(ownerId, current.blocked);
			if (current.blocked && !previouslyBlocked)
				void queryClient.cancelQueries();
			if (!current.blocked) {
				if (current.role !== null)
					onVerifiedRef.current({
						activeWorkspaceId: current.workspaceId,
						workspaceRole: current.role,
					});
				if (previouslyBlocked) void queryClient.invalidateQueries();
			}
			previouslyBlocked = current.blocked;
		};
		const unsubscribe = recovery.subscribe(synchronize);
		const uninstallLifecycle = installDraftLifecycle(ownerId);
		let lastActivity = Date.now();
		const activity = () => {
			lastActivity = Date.now();
		};
		const check = () => {
			if (document.visibilityState !== "hidden") void recovery.check();
		};
		const changed = () => {
			void recovery.recheck();
		};
		const storage = (event: StorageEvent) => {
			if (event.key === SESSION_CHANGE_KEY) changed();
		};
		const timer = setInterval(() => {
			if (Date.now() - lastActivity < 5 * 60_000) check();
		}, 60_000);
		window.addEventListener("pointerdown", activity, { passive: true });
		window.addEventListener("keydown", activity);
		window.addEventListener("online", changed);
		window.addEventListener(SESSION_CHANGE_EVENT, changed);
		window.addEventListener("storage", storage);
		document.addEventListener("visibilitychange", check);
		check();
		synchronize();
		return () => {
			uninstall();
			unsubscribe();
			uninstallLifecycle();
			recovery.invalidate();
			clearInterval(timer);
			window.removeEventListener("pointerdown", activity);
			window.removeEventListener("keydown", activity);
			window.removeEventListener("online", changed);
			window.removeEventListener(SESSION_CHANGE_EVENT, changed);
			window.removeEventListener("storage", storage);
			document.removeEventListener("visibilitychange", check);
		};
	}, [ownerId, queryClient, recovery]);
	const entries = registry.entries(ownerId);
	const volatile = registry.hasVolatileChanges(ownerId);
	const storageFailed = entries.some(
		(entry) => entry.getSnapshot().status === "storage-error",
	);
	const syncing = entries.some((entry) => entry.getSnapshot().dirty);
	const hidden = state.contentAccess === "hidden";
	const showBanner = state.blocked || storageFailed;
	useLayoutEffect(() => {
		const update = () =>
			frame.current?.style.setProperty(
				"--session-banner-height",
				`${banner.current?.getBoundingClientRect().height ?? 0}px`,
			);
		update();
		if (!showBanner || !banner.current) return;
		const observer = new ResizeObserver(update);
		observer.observe(banner.current);
		return () => observer.disconnect();
	}, [showBanner]);
	let message = state.message;
	if (hidden)
		message =
			state.status === "checking"
				? "Checking your sign-in. Your draft stays hidden until your original account and workspace access are verified."
				: "Your draft is hidden until your original account and workspace access are verified. Sign in to recover it.";
	else if (storageFailed)
		message =
			"Your latest changes could not be saved in this browser. Keep this tab open and download your draft.";
	else if (state.status === "expired")
		message = volatile
			? "Your session expired. Saving your latest changes in this browser…"
			: "Your session expired. Your changes are saved in this browser. Sign in to sync them.";
	else if (state.blocked && !message)
		message = "Checking your sign-in. Your draft will stay open.";
	return (
		<RecoveryContext.Provider value={state}>
			<div
				ref={frame}
				className="contents [&_[data-slot=sidebar-container]]:top-(--session-banner-height) [&_[data-slot=sidebar-container]]:h-[calc(100svh-var(--session-banner-height))] [&_[data-slot=sidebar-wrapper]]:min-h-[calc(100svh-var(--session-banner-height))] [&_main>header]:top-(--session-banner-height)"
			>
				{hidden ? (
					<style>
						{
							"[data-base-ui-portal]:not(:has([data-session-recovery-dialog])){display:none!important}"
						}
					</style>
				) : null}
				{showBanner ? (
					<div
						ref={banner}
						className="sticky top-0 z-50 flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-background px-4 py-3 text-sm shadow-sm dark:shadow-none"
						role="status"
						aria-live="polite"
					>
						<p className="min-w-48 flex-1">{message}</p>
						{state.blocked ? (
							<Button
								type="button"
								size="sm"
								onPointerDown={rememberFocus}
								onClick={() => {
									if (!focusBookmark.current) rememberFocus();
									setDialogOpen(true);
								}}
							>
								Sign in
							</Button>
						) : null}
						{state.status === "error" || state.status === "access-lost" ? (
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => void recovery.recheck()}
							>
								Check again
							</Button>
						) : null}
						{entries.length > 0 && !hidden ? (
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => downloadRecoveryDrafts(ownerId)}
							>
								Download draft
							</Button>
						) : null}
					</div>
				) : null}
				<div
					hidden={hidden}
					inert={state.contentAccess !== "available" ? true : undefined}
					className={hidden ? "hidden" : "contents"}
				>
					{children}
				</div>
				<span className="sr-only" role="status">
					{!state.blocked && syncing ? "Syncing your changes" : ""}
				</span>
				<SessionRecoveryDialog
					email={initial.user.email}
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					onAuthenticated={() => recovery.recheck()}
					restoreFocus={restoreFocus}
				/>
			</div>
		</RecoveryContext.Provider>
	);
}
