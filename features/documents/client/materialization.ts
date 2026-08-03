"use client";

import { apiClient } from "@/client";
import { queueDocumentMaterialization } from "../contracts";
import type { DocumentKind } from "../model";
import {
	acknowledgePendingTaskAttributions,
	batchTaskAttributions,
	snapshotPendingTaskAttributions,
} from "./task-attribution";

export async function queueMaterialization(
	kind: DocumentKind,
	entityId: string,
	attributionActorUserId?: string | null,
): Promise<void> {
	const taskAttributions =
		kind === "page" && attributionActorUserId
			? snapshotPendingTaskAttributions(entityId, attributionActorUserId)
			: [];
	const batches =
		kind === "page" ? batchTaskAttributions(taskAttributions) : [[]];
	for (const batch of batches) {
		await apiClient.endpoint(queueDocumentMaterialization).call({
			path: { kind, id: entityId },
			body: {
				...(batch.length > 0 ? { taskAttributions: batch } : {}),
			},
		});
		if (kind === "page" && batch.length > 0) {
			acknowledgePendingTaskAttributions(
				entityId,
				attributionActorUserId as string,
				batch,
			);
		}
	}
}
