import "@beignet/core/server-only";
import type { TenantScope, UnitOfWorkPort } from "@beignet/core/ports";
import * as Y from "yjs";
import type { CanvasRepository } from "@/features/canvases/ports";
import type { MemberRepository } from "@/features/members/ports";
import type { NotificationRepository } from "@/features/notifications/ports";
import { reconcilePageDerivations } from "@/features/pages/lib/apply-page-content";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import {
	PAGE_CHECKPOINT_INTERVAL_MS,
	PAGE_VERSION_RETENTION,
} from "@/features/pages/lib/version-retention";
import type {
	PageLinkRepository,
	PageRepository,
	PageVersionRepository,
} from "@/features/pages/ports";
import { extractTaskBlocks } from "@/features/tasks/lib/extract-task-blocks";
import { validatePageTaskBlocks } from "@/features/tasks/lib/reconcile-page-tasks";
import type { TaskAssignmentActor } from "@/features/tasks/notifications/assigned";
import type { TaskRepository } from "@/features/tasks/ports";
import type { AppTransactionPorts } from "@/ports";
import {
	canvasProjectionFromYDoc,
	canvasToYDoc,
	documentStateVector,
	documentUpdate,
	pageProjectionFromYDoc,
	pageToYDoc,
	yDocFromUpdate,
} from "./codec";
import {
	type CollaborativeDocument,
	DOCUMENT_SEED_LEASE_MS,
	type DocumentKind,
	documentId,
	isProviderVerificationFresh,
} from "./model";
import type { DocumentRegistryRepository, DocumentStorePort } from "./ports";
import { isCollaborativeDocumentSeeded } from "./seed-marker";
import { bytesToBase64 } from "./server-encoding";
import {
	pageTaskAttributionOperations,
	setPageTaskAttributionOperations,
} from "./task-attribution-operations";

type DocumentPorts = {
	canvases: CanvasRepository;
	documents: DocumentRegistryRepository;
	documentStore: DocumentStorePort;
	members: MemberRepository;
	notificationInbox: NotificationRepository;
	pageLinks: PageLinkRepository;
	pages: PageRepository;
	pageVersions: PageVersionRepository;
	tasks: TaskRepository;
	uow: UnitOfWorkPort<AppTransactionPorts>;
};

function seededMarker(doc: Y.Doc, kind: DocumentKind): boolean {
	return isCollaborativeDocumentSeeded(doc, kind);
}

type ReadyVerificationMode = boolean | "if-stale";
type ProviderVerificationResult = "cached" | "not-requested" | "provider";

function skippedProviderVerificationResult(
	mode: ReadyVerificationMode,
): ProviderVerificationResult {
	return mode === "if-stale" ? "cached" : "not-requested";
}

function readyDocumentNeedsProviderVerification(
	document: CollaborativeDocument | null,
	mode: ReadyVerificationMode,
): boolean {
	if (mode === true) return true;
	if (mode !== "if-stale") return false;
	return document === null || !isProviderVerificationFresh(document);
}

const SEED_WAIT_INTERVAL_MS = 50;
// Room initialization crosses both Turso and Liveblocks. A second browser can
// arrive while the first request still owns the seed lease, so wait through a
// normal collaboration handshake instead of failing after only two seconds.
const SEED_WAIT_ATTEMPTS = 160;
const SEED_HEARTBEAT_INTERVAL_MS = Math.max(
	1_000,
	Math.floor(DOCUMENT_SEED_LEASE_MS / 3),
);

function createSeedClaimGuard(input: {
	scope: TenantScope;
	documentId: string;
	expectedRevision: number;
	documents: DocumentRegistryRepository;
}) {
	let stopped = false;
	let lostError: Error | null = null;
	let renewal: Promise<void> | null = null;

	const renew = () => {
		if (stopped) return Promise.resolve();
		if (lostError) return Promise.reject(lostError);
		if (renewal) return renewal;
		renewal = input.documents
			.renewSeed(input.scope, input.documentId, {
				expectedRevision: input.expectedRevision,
			})
			.then((current) => {
				if (!current) {
					lostError = new Error(`Lost the seed claim for ${input.documentId}`);
					throw lostError;
				}
			})
			.catch((error) => {
				lostError =
					error instanceof Error
						? error
						: new Error(
								`Failed to renew the seed claim for ${input.documentId}`,
							);
				throw lostError;
			})
			.finally(() => {
				renewal = null;
			});
		return renewal;
	};

	const timer = setInterval(() => {
		void renew().catch(() => {
			// The next guarded provider write observes lostError and fails closed.
		});
	}, SEED_HEARTBEAT_INTERVAL_MS);
	if (typeof timer === "object" && "unref" in timer) timer.unref();

	return {
		assertCurrent: renew,
		stop() {
			stopped = true;
			clearInterval(timer);
		},
	};
}

async function waitForSeedResolution(
	scope: TenantScope,
	documentId: string,
	documents: DocumentRegistryRepository,
) {
	for (let attempt = 0; attempt < SEED_WAIT_ATTEMPTS; attempt += 1) {
		const current = await documents.findByDocumentId(scope, documentId);
		if (!current) {
			throw new Error(`Collaborative document ${documentId} is not registered`);
		}
		if (current.state !== "seeding") return current;
		await new Promise((resolve) => setTimeout(resolve, SEED_WAIT_INTERVAL_MS));
	}
	throw new Error(`Collaborative document ${documentId} is still being seeded`);
}

/** Seed one Yjs room from the SQLite projection. Retrying is safe: a room is
 * reused only when its atomic seed marker exists; an interrupted unmarked room
 * is replaced before a new seed is sent. */
export async function ensureCollaborativeDocument(input: {
	scope: TenantScope;
	kind: DocumentKind;
	entityId: string;
	ports: DocumentPorts;
	/** Re-read the provider document even when the registry is ready. `true`
	 * remains a forced recovery check for server reads and mutations;
	 * `"if-stale"` lets room authorization reuse a recent successful provider
	 * verification without caching any user or workspace authorization. */
	verifyReady?: ReadyVerificationMode;
	/** Replace a ready provider document from the current SQLite projection.
	 * This is reserved for the final SQLite-to-Yjs backfill while writes are
	 * paused; it must never run after the provider becomes authoritative. */
	refreshFromProjection?: boolean;
}): Promise<{
	documentId: string;
	seeded: boolean;
	refreshed: boolean;
	providerVerification: ProviderVerificationResult;
}> {
	const {
		scope,
		kind,
		entityId,
		ports,
		verifyReady = false,
		refreshFromProjection = false,
	} = input;
	const id = documentId(kind, entityId);
	const existing = await ports.documents.findByEntity(scope, kind, entityId);
	if (
		existing?.state === "ready" &&
		!readyDocumentNeedsProviderVerification(existing, verifyReady) &&
		!refreshFromProjection
	) {
		return {
			documentId: existing.documentId,
			seeded: false,
			refreshed: false,
			providerVerification: skippedProviderVerificationResult(verifyReady),
		};
	}

	const source =
		kind === "page"
			? await ports.pages.findById(scope, entityId)
			: await ports.canvases.findById(scope, entityId);
	if (!source) throw new Error(`Cannot seed missing ${kind} ${entityId}`);

	let registered = await ports.documents.createPending(scope, {
		documentId: id,
		provider: ports.documentStore.provider,
		kind,
		entityId,
		workspaceId: source.workspaceId,
	});
	let refreshingReady = refreshFromProjection && registered.state === "ready";

	for (let attempt = 0; attempt < 2; attempt += 1) {
		if (registered.state === "ready") {
			if (refreshFromProjection) refreshingReady = true;
			if (
				!readyDocumentNeedsProviderVerification(registered, verifyReady) &&
				!refreshFromProjection
			) {
				return {
					documentId: id,
					seeded: false,
					refreshed: false,
					providerVerification: skippedProviderVerificationResult(verifyReady),
				};
			}
			const remoteUpdate = await ports.documentStore.readBinaryUpdate(id);
			if (remoteUpdate) {
				const remote = yDocFromUpdate(remoteUpdate);
				try {
					if (seededMarker(remote, kind) && !refreshFromProjection) {
						const verifiedAt = new Date().toISOString();
						if (
							!(await ports.documents.markProviderVerified(scope, id, {
								expectedSeededAt: registered.seededAt,
								verifiedAt,
							}))
						) {
							const current = await ports.documents.findByDocumentId(scope, id);
							if (!current) {
								throw new Error(
									`Collaborative document ${id} is not registered`,
								);
							}
							registered =
								current.state === "seeding"
									? await waitForSeedResolution(scope, id, ports.documents)
									: current;
							continue;
						}
						return {
							documentId: id,
							seeded: false,
							refreshed: false,
							providerVerification: "provider",
						};
					}
				} finally {
					remote.destroy();
				}
			}
		}

		const claimed = await ports.documents.claimSeed(scope, id, {
			expectedRevision: registered.revision,
			expiredBefore: new Date(
				Date.now() - DOCUMENT_SEED_LEASE_MS,
			).toISOString(),
			allowReadyRepair: registered.state === "ready",
		});
		if (!claimed) {
			registered = await waitForSeedResolution(scope, id, ports.documents);
			continue;
		}
		const claimGuard = createSeedClaimGuard({
			scope,
			documentId: id,
			expectedRevision: claimed.revision,
			documents: ports.documents,
		});

		try {
			await claimGuard.assertCurrent();
			await ports.documentStore.ensureDocument({
				documentId: id,
				workspaceId: source.workspaceId,
				kind,
			});
			const remoteUpdate = await ports.documentStore.readBinaryUpdate(id);
			if (remoteUpdate) {
				const remote = yDocFromUpdate(remoteUpdate);
				try {
					if (seededMarker(remote, kind) && !refreshFromProjection) {
						if (
							!(await ports.documents.markReady(scope, id, {
								stateVector: bytesToBase64(documentStateVector(remote)),
								expectedRevision: claimed.revision,
							}))
						) {
							throw new Error(`Lost the seed claim for ${id}`);
						}
						return {
							documentId: id,
							seeded: false,
							refreshed: false,
							providerVerification: "provider",
						};
					}
				} finally {
					remote.destroy();
				}
				// Only the claim owner may replace an interrupted, unmarked room.
				await claimGuard.assertCurrent();
				await ports.documentStore.deleteDocument(id);
				await claimGuard.assertCurrent();
				await ports.documentStore.ensureDocument({
					documentId: id,
					workspaceId: source.workspaceId,
					kind,
				});
			}

			const doc =
				kind === "page"
					? pageToYDoc(
							source as Awaited<ReturnType<PageRepository["findById"]>> & {},
						)
					: canvasToYDoc(
							(source as Awaited<ReturnType<CanvasRepository["findById"]>> & {})
								.snapshot,
						);
			try {
				await claimGuard.assertCurrent();
				await ports.documentStore.applyBinaryUpdate(id, documentUpdate(doc));
				if (
					!(await ports.documents.markReady(scope, id, {
						stateVector: bytesToBase64(documentStateVector(doc)),
						expectedRevision: claimed.revision,
					}))
				) {
					throw new Error(`Lost the seed claim for ${id}`);
				}
			} finally {
				doc.destroy();
			}
			return {
				documentId: id,
				seeded: !refreshingReady,
				refreshed: refreshingReady,
				providerVerification: "provider",
			};
		} catch (error) {
			await ports.documents.markError(scope, id, {
				expectedRevision: claimed.revision,
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			claimGuard.stop();
		}
	}

	if (
		registered.state === "ready" &&
		!refreshFromProjection &&
		!readyDocumentNeedsProviderVerification(registered, verifyReady)
	) {
		return {
			documentId: id,
			seeded: false,
			refreshed: false,
			providerVerification: skippedProviderVerificationResult(verifyReady),
		};
	}
	throw new Error(`Collaborative document ${id} could not be seeded`);
}

/** Read the current authoritative page without waiting for its SQLite
 * projection. Used by direct reads such as MCP where freshness is expected. */
export async function readCollaborativePageProjection(input: {
	scope: TenantScope;
	entityId: string;
	ports: DocumentPorts;
}) {
	const decode = (update: Uint8Array) => {
		const doc = yDocFromUpdate(update);
		try {
			return seededMarker(doc, "page") ? pageProjectionFromYDoc(doc) : null;
		} finally {
			doc.destroy();
		}
	};
	let ensured = await ensureCollaborativeDocument({
		...input,
		kind: "page",
	});
	let update = await input.ports.documentStore.readBinaryUpdate(
		ensured.documentId,
	);
	let projection = update ? decode(update) : null;
	if (!projection) {
		ensured = await ensureCollaborativeDocument({
			...input,
			kind: "page",
			verifyReady: true,
		});
		update = await input.ports.documentStore.readBinaryUpdate(
			ensured.documentId,
		);
		projection = update ? decode(update) : null;
		if (!projection) {
			throw new Error(
				`Collaborative document ${ensured.documentId} is missing`,
			);
		}
	}
	return projection;
}

/** Read the current authoritative canvas without waiting for its SQLite
 * projection. Public shares use this so a synchronized drawing is immediately
 * visible even while its materialization job is still pending. */
export async function readCollaborativeCanvasProjection(input: {
	scope: TenantScope;
	entityId: string;
	ports: DocumentPorts;
}) {
	const decode = (update: Uint8Array) => {
		const doc = yDocFromUpdate(update);
		try {
			return seededMarker(doc, "canvas") ? canvasProjectionFromYDoc(doc) : null;
		} finally {
			doc.destroy();
		}
	};
	let ensured = await ensureCollaborativeDocument({
		...input,
		kind: "canvas",
	});
	let update = await input.ports.documentStore.readBinaryUpdate(
		ensured.documentId,
	);
	let projection = update ? decode(update) : null;
	if (!projection) {
		ensured = await ensureCollaborativeDocument({
			...input,
			kind: "canvas",
			verifyReady: true,
		});
		update = await input.ports.documentStore.readBinaryUpdate(
			ensured.documentId,
		);
		projection = update ? decode(update) : null;
		if (!projection) {
			throw new Error(
				`Collaborative document ${ensured.documentId} is missing`,
			);
		}
	}
	return projection;
}

export type MaterializeResult =
	| {
			status: "unchanged";
			kind: "page";
			updatedAt: string;
			contentUpdatedAt: string;
			titleChanged: false;
			contentChanged: false;
			tasksChanged: false;
			linksChanged: false;
			assignmentNotifications: [];
	  }
	| {
			status: "unchanged";
			kind: "canvas";
			updatedAt: string;
	  }
	| {
			status: "projected";
			kind: "page";
			updatedAt: string;
			contentUpdatedAt: string;
			titleChanged: boolean;
			contentChanged: boolean;
			tasksChanged: boolean;
			linksChanged: boolean;
			assignmentNotifications: Awaited<
				ReturnType<typeof reconcilePageDerivations>
			>["assignmentNotifications"];
	  }
	| { status: "projected"; kind: "canvas"; updatedAt: string };

class ProjectionRevisionChangedError extends Error {}

const TASK_ATTRIBUTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TrustedTaskAttribution = {
	id?: string;
	blockId: string;
	assignee: string;
	operationId: string;
	actor: TaskAssignmentActor;
};

type ServerTaskAttributionChanges = {
	attributions: TrustedTaskAttribution[];
	operations: Array<{ blockId: string; operationId: string | null }>;
};

function recordServerTaskAttributions(
	previousContent: Parameters<typeof extractTaskBlocks>[0],
	nextContent: Parameters<typeof extractTaskBlocks>[0],
	actor: TaskAssignmentActor | undefined,
): ServerTaskAttributionChanges {
	const previous = new Map(
		extractTaskBlocks(previousContent).map((block) => [block.blockId, block]),
	);
	const next = new Map(
		extractTaskBlocks(nextContent).map((block) => [block.blockId, block]),
	);
	const attributions: TrustedTaskAttribution[] = [];
	const operations: ServerTaskAttributionChanges["operations"] = [];

	for (const [blockId, block] of next) {
		const prior = previous.get(blockId);
		if (prior?.rawAssignee === block.rawAssignee) continue;
		if (actor && block.rawAssignee.length > 0) {
			const operationId = crypto.randomUUID();
			attributions.push({
				blockId,
				assignee: block.rawAssignee,
				operationId,
				actor,
			});
			operations.push({ blockId, operationId });
		} else {
			// Clearing an assignment (or changing it without authenticated
			// provenance) must also clear any older nonce in the Yjs document.
			operations.push({ blockId, operationId: null });
		}
	}
	for (const blockId of previous.keys()) {
		if (!next.has(blockId)) operations.push({ blockId, operationId: null });
	}

	return { attributions, operations };
}

async function resolveTaskAttributions(
	content: Parameters<typeof extractTaskBlocks>[0],
	operationByBlockId: ReadonlyMap<string, string>,
	trustedAttributions: readonly TrustedTaskAttribution[],
	ports: Pick<DocumentPorts, "members">,
	scope: TenantScope,
) {
	const trusted = new Map<string, TrustedTaskAttribution[]>();
	for (const attribution of trustedAttributions) {
		const values = trusted.get(attribution.blockId) ?? [];
		values.push(attribution);
		trusted.set(attribution.blockId, values);
	}
	const roster = new Map(
		(await ports.members.listByWorkspace(scope)).map((member) => [
			member.userId,
			member,
		]),
	);
	const resolved = new Map<
		string,
		{
			assignmentActor: TaskAssignmentActor;
			defaultAssigneeId: string | null;
		}
	>();
	const consumedAttributionIds = new Set<string>();
	for (const block of extractTaskBlocks(content)) {
		const currentOperationId = operationByBlockId.get(block.blockId);
		const matchingAttributions = trusted
			.get(block.blockId)
			?.filter(
				(candidate) =>
					candidate.assignee === block.rawAssignee &&
					candidate.operationId === currentOperationId,
			);
		const attribution = matchingAttributions?.[0];
		if (!attribution) continue;
		const actor = roster.get(attribution.actor.userId);
		if (!actor) continue;
		for (const candidate of matchingAttributions ?? []) {
			if (candidate.id) consumedAttributionIds.add(candidate.id);
		}
		resolved.set(block.blockId, {
			assignmentActor: attribution.actor,
			defaultAssigneeId: block.useDefaultAssignee ? actor.userId : null,
		});
	}
	return {
		attributionByBlockId: resolved,
		consumedAttributionIds: [...consumedAttributionIds],
	};
}

/** Refresh SQLite's query/search/share projection from the authoritative Ydoc. */
async function materializeCollaborativeDocumentAttempt(
	input: {
		scope: TenantScope;
		documentId: string;
		ports: DocumentPorts;
		taskAttributions?: readonly TrustedTaskAttribution[];
	},
	attempt: number,
): Promise<MaterializeResult> {
	const { scope, documentId: id, ports } = input;
	const registered = await ports.documents.findByDocumentId(scope, id);
	if (registered?.state !== "ready") {
		throw new Error(`Collaborative document ${id} is not ready`);
	}
	const update = await ports.documentStore.readBinaryUpdate(id);
	if (!update) {
		if (attempt >= 2) {
			throw new Error(`Collaborative document ${id} is missing`);
		}
		await ensureCollaborativeDocument({
			scope,
			kind: registered.kind,
			entityId: registered.entityId,
			ports,
			verifyReady: true,
		});
		return materializeCollaborativeDocumentAttempt(input, attempt + 1);
	}
	const doc = yDocFromUpdate(update);
	try {
		const vector = bytesToBase64(documentStateVector(doc));
		if (
			registered.kind === "canvas" &&
			registered.lastProjectedAt !== null &&
			registered.lastStateVector === vector
		) {
			const current = await ports.canvases.findById(scope, registered.entityId);
			if (!current)
				throw new Error(`Canvas ${registered.entityId} was deleted`);
			return {
				status: "unchanged",
				kind: "canvas",
				updatedAt: current.updatedAt,
			};
		}

		return await ports.uow.transaction(async (tx) => {
			if (registered.kind === "page") {
				const durableAttributions = await tx.documents.listTaskAttributions(
					scope,
					id,
				);
				const expiredBefore = Date.now() - TASK_ATTRIBUTION_RETENTION_MS;
				const expiredAttributionIds = durableAttributions
					.filter(
						(attribution) => Date.parse(attribution.updatedAt) < expiredBefore,
					)
					.map((attribution) => attribution.id);
				if (expiredAttributionIds.length > 0) {
					await tx.documents.deleteTaskAttributions(
						scope,
						id,
						expiredAttributionIds,
					);
				}
				const persistedAttributions = durableAttributions
					.filter(
						(
							attribution,
						): attribution is typeof attribution & { operationId: string } =>
							!expiredAttributionIds.includes(attribution.id) &&
							attribution.operationId !== null,
					)
					.map((attribution) => ({
						id: attribution.id,
						blockId: attribution.blockId,
						assignee: attribution.assignee,
						operationId: attribution.operationId,
						actor: {
							userId: attribution.actorUserId,
							name: attribution.actorName,
						},
					}));
				const current = await tx.pages.findById(scope, registered.entityId);
				if (!current)
					throw new Error(`Page ${registered.entityId} was deleted`);
				const projection = pageProjectionFromYDoc(doc);
				const attributionOperations = pageTaskAttributionOperations(doc);
				const { attributionByBlockId, consumedAttributionIds } =
					await resolveTaskAttributions(
						projection.content,
						attributionOperations,
						[...(input.taskAttributions ?? []), ...persistedAttributions],
						{ members: tx.members },
						scope,
					);
				const contentChanged =
					JSON.stringify(projection.content) !==
					JSON.stringify(current.content);
				const titleChanged = projection.title !== current.title;
				if (
					!titleChanged &&
					!contentChanged &&
					attributionByBlockId.size === 0 &&
					registered.lastProjectedAt !== null &&
					registered.lastStateVector === vector
				) {
					return {
						status: "unchanged",
						kind: "page",
						updatedAt: current.updatedAt,
						contentUpdatedAt: current.contentUpdatedAt,
						titleChanged: false,
						contentChanged: false,
						tasksChanged: false,
						linksChanged: false,
						assignmentNotifications: [],
					} as const;
				}
				if (titleChanged || contentChanged) {
					const latestVersionAt = await tx.pageVersions.latestCreatedAt(
						scope,
						current.id,
					);
					const checkpointDue =
						latestVersionAt === null ||
						Date.now() - Date.parse(latestVersionAt) >=
							PAGE_CHECKPOINT_INTERVAL_MS;
					if (checkpointDue && current.content.length > 0) {
						await tx.pageVersions.create(scope, {
							pageId: current.id,
							title: current.title,
							icon: current.icon,
							contentJson: JSON.stringify(current.content),
							cause: "checkpoint",
							createdBy: current.userId,
						});
						await tx.pageVersions.prune(
							scope,
							current.id,
							PAGE_VERSION_RETENTION,
						);
					}
				}
				let updatedAt = current.updatedAt;
				let contentUpdatedAt = current.contentUpdatedAt;
				let tasksChanged = false;
				let linksChanged = false;
				let assignmentNotifications: Awaited<
					ReturnType<typeof reconcilePageDerivations>
				>["assignmentNotifications"] = [];
				if (titleChanged) {
					updatedAt = (
						await tx.pages.update(scope, current.id, {
							title: projection.title,
						})
					).updatedAt;
				}
				if (contentChanged || attributionByBlockId.size > 0) {
					if (contentChanged) {
						const saved = await tx.pages.saveContent(
							scope,
							current.id,
							JSON.stringify(projection.content),
							extractPageSearchText(projection.content),
						);
						updatedAt = saved.updatedAt;
						contentUpdatedAt = saved.contentUpdatedAt;
					}
					const derivations = await reconcilePageDerivations(
						tx,
						scope,
						{ ...current, title: projection.title },
						projection.content,
						{
							attributionByBlockId,
							requireTaskAssignmentAttribution: true,
						},
					);
					tasksChanged = derivations.tasksChanged;
					linksChanged = derivations.linksChanged;
					assignmentNotifications = derivations.assignmentNotifications;
				}
				if (consumedAttributionIds.length > 0) {
					await tx.documents.deleteTaskAttributions(
						scope,
						id,
						consumedAttributionIds,
					);
				}
				if (
					!(await tx.documents.markProjected(scope, id, {
						stateVector: vector,
						expectedRevision: registered.revision,
					}))
				) {
					throw new ProjectionRevisionChangedError();
				}
				return {
					status: "projected",
					kind: "page",
					updatedAt,
					contentUpdatedAt,
					titleChanged,
					contentChanged,
					tasksChanged,
					linksChanged,
					assignmentNotifications,
				} as const;
			}

			const current = await tx.canvases.findById(scope, registered.entityId);
			if (!current)
				throw new Error(`Canvas ${registered.entityId} was deleted`);
			const snapshot = canvasProjectionFromYDoc(doc);
			let updatedAt = current.updatedAt;
			if (JSON.stringify(snapshot) !== JSON.stringify(current.snapshot)) {
				updatedAt = (
					await tx.canvases.saveSnapshot(
						scope,
						current.id,
						JSON.stringify(snapshot),
					)
				).updatedAt;
			}
			if (
				!(await tx.documents.markProjected(scope, id, {
					stateVector: vector,
					expectedRevision: registered.revision,
				}))
			) {
				throw new ProjectionRevisionChangedError();
			}
			return { status: "projected", kind: "canvas", updatedAt } as const;
		});
	} catch (error) {
		if (error instanceof ProjectionRevisionChangedError && attempt < 2) {
			return materializeCollaborativeDocumentAttempt(input, attempt + 1);
		}
		throw error;
	} finally {
		doc.destroy();
	}
}

export function materializeCollaborativeDocument(input: {
	scope: TenantScope;
	documentId: string;
	ports: DocumentPorts;
	taskAttributions?: readonly TrustedTaskAttribution[];
}): Promise<MaterializeResult> {
	return materializeCollaborativeDocumentAttempt(input, 0);
}

/** Server/MCP mutation primitive. It sends only the differential update and
 * synchronously refreshes projections so the caller can read its own write. */
export async function mutateCollaborativeDocument(input: {
	scope: TenantScope;
	kind: DocumentKind;
	entityId: string;
	ports: DocumentPorts;
	assignmentActor?: TaskAssignmentActor;
	defaultTaskAssigneeId?: string | null;
	apply(doc: Y.Doc): void | Promise<void>;
	/** Runs after the proposed document validates but before its update is sent.
	 * Use this for durable pre-mutation checkpoints derived during apply. */
	beforeWrite?(): void | Promise<void>;
}): Promise<MaterializeResult> {
	// A provider room can be removed independently of the registry (manual
	// cleanup, retention, or an interrupted provider migration). Server and MCP
	// writes have no preceding browser room-auth request to repair that drift, so
	// verify the provider before applying an authoritative mutation.
	const ensured = await ensureCollaborativeDocument({
		...input,
		verifyReady: true,
	});
	const update = await input.ports.documentStore.readBinaryUpdate(
		ensured.documentId,
	);
	if (!update)
		throw new Error(`Collaborative document ${ensured.documentId} is missing`);
	const doc = yDocFromUpdate(update);
	let taskAttributions: TrustedTaskAttribution[] = [];
	let taskAttributionOperations: ServerTaskAttributionChanges["operations"] =
		[];
	try {
		const before = documentStateVector(doc);
		const previousPageContent =
			input.kind === "page" ? pageProjectionFromYDoc(doc).content : null;
		await input.apply(doc);
		if (input.kind === "page") {
			const nextContent = pageProjectionFromYDoc(doc).content;
			await validatePageTaskBlocks(
				{
					members: input.ports.members,
					tasks: input.ports.tasks,
				},
				input.scope,
				input.entityId,
				nextContent,
				{ defaultAssigneeId: input.defaultTaskAssigneeId },
			);
			const attributionChanges = recordServerTaskAttributions(
				previousPageContent ?? [],
				nextContent,
				input.assignmentActor,
			);
			taskAttributions = attributionChanges.attributions;
			taskAttributionOperations = attributionChanges.operations;
			setPageTaskAttributionOperations(doc, taskAttributionOperations);
		}
		const differential = Y.encodeStateAsUpdate(doc, before);
		if (differential.byteLength > 2) {
			await input.beforeWrite?.();
			if (taskAttributions.length > 0) {
				// The provider update can outlive this request and be projected later by
				// a webhook. Persist the actor first so that recovery path attributes the
				// assignment exactly like the synchronous materialization below.
				await input.ports.uow.transaction((tx) =>
					tx.documents.recordTaskAttributions(
						input.scope,
						ensured.documentId,
						taskAttributions.map((attribution) => ({
							blockId: attribution.blockId,
							assignee: attribution.assignee,
							operationId: attribution.operationId,
							actorUserId: attribution.actor.userId,
							actorName: attribution.actor.name,
						})),
					),
				);
			}
			await input.ports.documentStore.applyBinaryUpdate(
				ensured.documentId,
				differential,
			);
		}
	} finally {
		doc.destroy();
	}
	return materializeCollaborativeDocument({
		scope: input.scope,
		documentId: ensured.documentId,
		ports: input.ports,
	});
}
