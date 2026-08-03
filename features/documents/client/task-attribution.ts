"use client";

import type { PendingTaskAttribution } from "@/features/pages/lib/collab-document";

const STORAGE_PREFIX = "haunter:task-attributions:v1";
const pendingByActorPage = new Map<string, Map<string, string>>();
export const MAX_TASK_ATTRIBUTIONS_PER_MATERIALIZATION = 100;

function actorPageKey(pageId: string, actorUserId: string): string {
	return `${actorUserId}:${pageId}`;
}

function storageKey(pageId: string, actorUserId: string): string {
	return `${STORAGE_PREFIX}:${actorUserId}:${pageId}`;
}

function browserStorage(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

function pendingFor(pageId: string, actorUserId: string): Map<string, string> {
	const key = actorPageKey(pageId, actorUserId);
	const storage = browserStorage();
	if (!storage) return pendingByActorPage.get(key) ?? new Map();
	const pending = new Map<string, string>();
	const serialized = storage.getItem(storageKey(pageId, actorUserId));
	if (serialized) {
		try {
			const values = JSON.parse(serialized) as Record<string, unknown>;
			for (const [blockId, assignee] of Object.entries(values)) {
				if (blockId && typeof assignee === "string" && assignee) {
					pending.set(blockId, assignee);
				}
			}
		} catch {
			storage.removeItem(storageKey(pageId, actorUserId));
		}
	}
	return pending;
}

function persistPending(
	pageId: string,
	actorUserId: string,
	pending: Map<string, string>,
): void {
	const key = actorPageKey(pageId, actorUserId);
	const storage = browserStorage();
	if (!storage) {
		if (pending.size === 0) pendingByActorPage.delete(key);
		else pendingByActorPage.set(key, pending);
		return;
	}
	if (pending.size === 0) {
		storage.removeItem(storageKey(pageId, actorUserId));
		return;
	}
	storage.setItem(
		storageKey(pageId, actorUserId),
		JSON.stringify(Object.fromEntries(pending)),
	);
}

export function recordPendingTaskAttributions(
	pageId: string,
	actorUserId: string,
	attributions: readonly PendingTaskAttribution[],
): void {
	const pending = pendingFor(pageId, actorUserId);
	for (const attribution of attributions) {
		if (attribution.assignee === null) pending.delete(attribution.blockId);
		else pending.set(attribution.blockId, attribution.assignee);
	}
	persistPending(pageId, actorUserId, pending);
}

export function snapshotPendingTaskAttributions(
	pageId: string,
	actorUserId: string,
) {
	return [...pendingFor(pageId, actorUserId)].map(([blockId, assignee]) => ({
		blockId,
		assignee,
	}));
}

/** Keep each request within the server boundary without losing attribution for
 * a large paste/import. Empty input still produces one actorless projection
 * request so ordinary page edits are materialized. */
export function batchTaskAttributions(
	attributions: readonly { blockId: string; assignee: string }[],
): Array<Array<{ blockId: string; assignee: string }>> {
	if (attributions.length === 0) return [[]];
	const batches: Array<Array<{ blockId: string; assignee: string }>> = [];
	for (
		let index = 0;
		index < attributions.length;
		index += MAX_TASK_ATTRIBUTIONS_PER_MATERIALIZATION
	) {
		batches.push(
			attributions.slice(
				index,
				index + MAX_TASK_ATTRIBUTIONS_PER_MATERIALIZATION,
			),
		);
	}
	return batches;
}

export function acknowledgePendingTaskAttributions(
	pageId: string,
	actorUserId: string,
	acknowledged: readonly { blockId: string; assignee: string }[],
): void {
	const pending = pendingFor(pageId, actorUserId);
	for (const attribution of acknowledged) {
		if (pending.get(attribution.blockId) === attribution.assignee) {
			pending.delete(attribution.blockId);
		}
	}
	persistPending(pageId, actorUserId, pending);
}
