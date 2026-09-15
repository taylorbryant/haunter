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
import { listPages } from "@/features/pages/contracts";
import type { PageMeta } from "@/features/pages/schemas";
import { workspaceChanges } from "../channels";
import {
	isWorkspacePageEvent,
	workspaceEventRemovesPage,
} from "../workspace-events";
import { createWorkspaceRefreshGate } from "./refresh-gate";
import {
	workspaceEventQueries,
	workspaceReconciliationQueries,
} from "./workspace-event-cache";

export function subscribeToWorkspaceChanges(options: {
	client: BroadcastClient;
	queryClient: QueryClient;
	workspaceId: string;
	getCurrentPageId(): string | undefined;
	onPageRemoved(pageId: string): void;
	onError?(error: unknown): void;
	onSync?(info: BroadcastConnectionInfo): void;
	refreshGate?: BroadcastRefreshGate;
}) {
	const { queryClient, workspaceId } = options;
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
	let subscription: BroadcastClientSubscription;
	try {
		subscription = createBroadcastQuerySubscription({
			client: options.client,
			channel: workspaceChanges,
			params: { workspaceId },
			queryClient,
			refreshGate: gate,
			invalidates({ data }) {
				if (data.workspaceId !== workspaceId) return [];
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
				requiredFetch = fetchSequence + 1;
				pageToReconcile = options.getCurrentPageId();
				options.onSync?.(info);
			},
			onError: options.onError,
		});
	} catch (error) {
		stopCache();
		throw error;
	}
	return () => {
		closed = true;
		stopCache();
		subscription.unsubscribe();
	};
}
