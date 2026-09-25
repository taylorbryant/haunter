import type {
	BroadcastClient,
	BroadcastClientSubscription,
	BroadcastConnectionInfo,
} from "@beignet/core/broadcasting/client";
import {
	type BroadcastRefreshGate,
	createBroadcastQuerySubscription,
} from "@beignet/react-query";
import { matchQuery, type QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	clearPageAgentActivity,
	receivePageAgentActivity,
} from "@/features/agents/client/page-activity-cache";
import { isPageAgentActivity } from "@/features/agents/page-activity";
import {
	clearCanvasAgentActivity,
	receiveCanvasAgentActivity,
} from "@/features/agents/client/canvas-activity-cache";
import { listPages } from "@/features/pages/contracts";
import type { PageMeta } from "@/features/pages/schemas";
import { workspaceChanges, workspaceCanvasActivity } from "../channels";
import {
	isWorkspacePageEvent,
	workspaceEventRemovesPage,
} from "../workspace-events";
import { createWorkspaceRefreshGate } from "./refresh-gate";
import type { WorkspaceEventClock } from "./event-clock";
import {
	workspaceEventQueries,
	workspaceReconciliationQueries,
} from "./workspace-event-cache";

export function subscribeToWorkspaceChanges(options: {
	client: BroadcastClient;
	queryClient: QueryClient;
	userId: string;
	workspaceId: string;
	getClock(): WorkspaceEventClock | null;
	getCurrentPageId(): string | undefined;
	onPageRemoved(pageId: string): void;
	onError?(error: unknown): void;
	onSync?(info: BroadcastConnectionInfo): void;
	refreshGate?: BroadcastRefreshGate;
}) {
	const { queryClient, userId, workspaceId } = options;
	const clearPagePresence = () =>
		clearPageAgentActivity(queryClient, userId, workspaceId);
	const clearCanvasPresence = () =>
		clearCanvasAgentActivity(queryClient, userId, workspaceId);
	const gate = options.refreshGate ?? createWorkspaceRefreshGate(queryClient);
	const pages = rq(listPages).filter({ path: { workspaceId } });
	let closed = false;
	let fetchSequence = 0;
	let requiredFetch: number | null = null;
	let pageToReconcile: string | undefined;
	// Readiness is not refresh completion. Only a fetch started after onSync
	// can prove that a page disappeared while this browser was disconnected.
	const stopCache = queryClient.getQueryCache().subscribe((event) => {
		if (closed || event.type !== "updated" || !matchQuery(pages, event.query))
			return;
		if (event.action.type === "fetch") fetchSequence++;
		if (
			requiredFetch === null ||
			fetchSequence < requiredFetch ||
			event.action.type !== "success" ||
			event.action.manual
		)
			return;
		try {
			if (gate.isBlocked(event.query)) return;
		} catch (error) {
			options.onError?.(error);
			return;
		}
		requiredFetch = null;
		const pageId = pageToReconcile;
		const data = event.query.state.data as { items: PageMeta[] } | undefined;
		if (
			pageId &&
			options.getCurrentPageId() === pageId &&
			data &&
			!data.items.some((page) => page.id === pageId)
		)
			options.onPageRemoved(pageId);
	});
	let subscription: BroadcastClientSubscription | undefined;
	let canvasSubscription: BroadcastClientSubscription | undefined;
	try {
		subscription = createBroadcastQuerySubscription({
			client: options.client,
			channel: workspaceChanges,
			params: { workspaceId },
			queryClient,
			refreshGate: gate,
			invalidates({ data }) {
				if (closed || data.workspaceId !== workspaceId) return [];
				if (isPageAgentActivity(data)) {
					const clock = options.getClock();
					if (clock)
						receivePageAgentActivity(
							queryClient,
							userId,
							workspaceId,
							data,
							clock,
						);
					return [];
				}
				const pageId = options.getCurrentPageId();
				if (
					pageId &&
					isWorkspacePageEvent(data) &&
					workspaceEventRemovesPage(data, pageId)
				)
					options.onPageRemoved(pageId);
				return workspaceEventQueries(workspaceId, data);
			},
			reconciles: workspaceReconciliationQueries(workspaceId),
			onSync(info) {
				if (closed) return;
				clearPagePresence();
				requiredFetch = fetchSequence + 1;
				pageToReconcile = options.getCurrentPageId();
				options.onSync?.(info);
			},
			onStatusChange(status) {
				if (!closed && status !== "connected") clearPagePresence();
			},
			onError: options.onError,
		});
		// Both channels share one SSE connection and admission lease. Activity is
		// transient and must never invalidate document queries or reconcile pages.
		canvasSubscription = options.client.subscribe(workspaceCanvasActivity, {
			params: { workspaceId },
			onEvent({ data }) {
				if (closed || data.workspaceId !== workspaceId) return;
				const clock = options.getClock();
				if (clock)
					receiveCanvasAgentActivity(
						queryClient,
						userId,
						workspaceId,
						data,
						clock,
					);
			},
			onSync() {
				if (!closed) clearCanvasPresence();
			},
			onStatusChange(status) {
				if (!closed && status !== "connected") clearCanvasPresence();
			},
			onError: options.onError,
		});
	} catch (error) {
		closed = true;
		stopCache();
		clearPagePresence();
		clearCanvasPresence();
		subscription?.unsubscribe();
		canvasSubscription?.unsubscribe();
		throw error;
	}
	return () => {
		if (closed) return;
		closed = true;
		stopCache();
		clearPagePresence();
		clearCanvasPresence();
		subscription?.unsubscribe();
		canvasSubscription?.unsubscribe();
	};
}
