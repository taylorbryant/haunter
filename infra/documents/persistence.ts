import { createTenantScope } from "@beignet/core/ports";
import * as Y from "yjs";
import type { AppContext } from "@/app-context";
import { reconcilePageDerivations } from "@/features/pages/lib/apply-page-content";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import { appError } from "@/features/shared/errors";
import { checkpointPageBeforeWrite } from "@/features/pages/lib/checkpoint-page";
import {
	assertMovePreservesBlocks,
	documentBlockIds,
	reconcileBlockMoves,
} from "./move-conflicts";
import { validateDocumentState } from "./validate-update";
import { createPersistenceReceipt } from "@/features/documents/receipt";
import { DocumentRestoredError } from "@/features/documents/restoration";
import type { AssignmentChange } from "./assignment-attribution";
import { extractTaskBlocks } from "@/features/tasks/lib/extract-task-blocks";
import type { TaskAssignmentActor } from "@/features/tasks/ports";

export async function loadPageBody(
	ctx: AppContext,
	workspaceId: string,
	pageId: string,
) {
	const scope = createTenantScope({ id: workspaceId });
	const stored = await ctx.ports.documents.find(scope, pageId);
	if (!stored)
		throw new Error(
			"Page body is not migrated. Run the document migration before starting the app.",
		);
	return stored;
}

/** The state, derived rows and revision commit together. */
export async function persistPageBody(
	ctx: AppContext,
	input: {
		workspaceId: string;
		pageId: string;
		baseRevision: number;
		generation: number;
		doc: Y.Doc;
		assignmentChanges?: ReadonlyMap<string, AssignmentChange>;
		workerOwnerId?: string;
	},
) {
	// Capture synchronously: later keystrokes must not be covered by this receipt.
	const captured = Y.encodeStateAsUpdate(input.doc);
	const merged = new Y.Doc();
	Y.applyUpdate(merged, captured);
	const scope = createTenantScope({ id: input.workspaceId });
	try {
		return await ctx.ports.uow.transaction(async (tx) => {
			if (input.workerOwnerId)
				await tx.documents.assertWorkerLease(input.workerOwnerId);
			const generation = await tx.documents.getGeneration(scope, input.pageId);
			if (generation !== input.generation)
				throw new DocumentRestoredError(generation ?? 0);
			// HTTP task actions and appends may have committed since this worker's
			// last save. Merge their CRDT history before producing either projection.
			const [newer] = await tx.documents.findChanged(scope, [
				{ pageId: input.pageId, revision: input.baseRevision },
			]);
			const previousIds = documentBlockIds(merged);
			if (newer) Y.applyUpdate(merged, newer.state);
			if (reconcileBlockMoves(merged))
				assertMovePreservesBlocks(previousIds, merged);
			const content = validateDocumentState(merged);
			const state = Y.encodeStateAsUpdate(merged);
			const receipt = createPersistenceReceipt(merged);
			const externalChanges = !!newer;
			const page = await tx.pages.findById(scope, input.pageId);
			if (!page) throw appError("PageNotFound");
			await checkpointPageBeforeWrite(tx, scope, page.id, null);
			const saved = await tx.documents.commit(scope, {
				pageId: page.id,
				baseRevision: newer?.revision ?? input.baseRevision,
				generation: input.generation,
				state,
				contentJson: JSON.stringify(content),
				searchText: extractPageSearchText(content),
			});
			const assignmentActorsByBlock = new Map<string, TaskAssignmentActor>();
			if (input.assignmentChanges?.size) {
				const members = await tx.members.listByWorkspace(scope);
				for (const block of extractTaskBlocks(content)) {
					const change = input.assignmentChanges.get(block.blockId);
					const member =
						change?.userId && change.assignee === block.assignee
							? members.find((candidate) => candidate.userId === change.userId)
							: undefined;
					if (member)
						assignmentActorsByBlock.set(block.blockId, {
							userId: member.userId,
							name: member.name.trim() || "A teammate",
						});
				}
			}
			// Preserve accepted updates even if a page was trashed while a save was in flight.
			const derived =
				page.deletedAt === null
					? await reconcilePageDerivations(tx, scope, page, content, {
							defaultTaskAssigneeId: page.userId,
							assignmentActor: { userId: null, name: "A teammate" },
							assignmentActorsByBlock,
						})
					: {
							tasksChanged: false,
							linksChanged: false,
							assignmentNotifications: [],
						};
			return {
				...saved,
				assignmentNotifications: derived.assignmentNotifications,
				tasksChanged: derived.tasksChanged || externalChanges,
				linksChanged: derived.linksChanged || externalChanges,
				state,
				...receipt,
			};
		});
	} finally {
		merged.destroy();
	}
}
