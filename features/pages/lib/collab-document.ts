/** Shared Y.Map keys for the database state represented by the Yjs document. */
export const COLLAB_CONTENT_VERSION_KEY = "contentUpdatedAt";
export const COLLAB_SEEDED_KEY = "seeded";
type AttributionBlock = {
	id: string;
	type: string;
	props?: Record<string, unknown>;
};

export type TaskAttributionBlockChange = {
	type: "insert" | "delete" | "update" | "move";
	block: AttributionBlock;
	prevBlock?: AttributionBlock;
	source: { type: string };
};

export type PendingTaskAttribution = {
	blockId: string;
	assignee: string | null;
	operationId: string | null;
};

function rawTaskAssignee(block: AttributionBlock | undefined): string | null {
	if (block?.type !== "task") return null;
	const assignee = block.props?.assignee;
	return typeof assignee === "string" ? assignee : "";
}

/** Attach the current user only to task creation/assignment changes authored
 * by this editor. The authenticated materialization request binds the actor;
 * the Yjs document itself is not trusted to assert user identity. */
export function taskAttributionsForChanges(
	changes: readonly TaskAttributionBlockChange[],
): PendingTaskAttribution[] {
	const attributions = new Map<string, string | null>();
	for (const change of changes) {
		if (change.source.type === "yjs-remote" || change.type === "move") continue;
		const nextAssignee = rawTaskAssignee(change.block);
		const previousAssignee = rawTaskAssignee(change.prevBlock);
		if (change.type === "delete" || nextAssignee === null) {
			if (rawTaskAssignee(change.block) !== null || previousAssignee !== null) {
				attributions.set(change.block.id, null);
			}
			continue;
		}
		if (
			change.type === "insert" ||
			previousAssignee === null ||
			previousAssignee !== nextAssignee
		) {
			attributions.set(
				change.block.id,
				nextAssignee.length > 0 ? nextAssignee : null,
			);
		}
	}
	return [...attributions].map(([blockId, assignee]) => ({
		blockId,
		assignee,
		operationId: assignee === null ? null : crypto.randomUUID(),
	}));
}
