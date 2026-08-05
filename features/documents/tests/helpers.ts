import { tenantScopeId } from "@beignet/core/ports";
import * as Y from "yjs";
import {
	type CollaborativeDocument,
	DOCUMENT_SCHEMA_VERSION,
	DOCUMENT_SEED_LEASE_MS,
} from "@/features/documents/model";
import type {
	DocumentRegistryRepository,
	DocumentStorePort,
} from "@/features/documents/ports";

export function createTestDocumentStore(): DocumentStorePort {
	const updates = new Map<string, Uint8Array>();
	return {
		provider: "liveblocks",
		async ensureDocument({ documentId }) {
			if (updates.has(documentId)) return;
			const doc = new Y.Doc();
			updates.set(documentId, Y.encodeStateAsUpdate(doc));
			doc.destroy();
		},
		async readBinaryUpdate(documentId) {
			const update = updates.get(documentId);
			return update ? new Uint8Array(update) : null;
		},
		async applyBinaryUpdate(documentId, update) {
			const doc = new Y.Doc();
			const current = updates.get(documentId);
			if (current) Y.applyUpdate(doc, current);
			Y.applyUpdate(doc, update);
			updates.set(documentId, Y.encodeStateAsUpdate(doc));
			doc.destroy();
		},
		async deleteDocument(documentId) {
			updates.delete(documentId);
		},
	};
}

export function createTestDocumentRegistryRepository(): DocumentRegistryRepository {
	const documents = new Map<string, CollaborativeDocument>();
	const taskAttributions = new Map<
		string,
		Awaited<
			ReturnType<DocumentRegistryRepository["listTaskAttributions"]>
		>[number]
	>();
	return {
		async findByDocumentId(scope, documentId) {
			const document = documents.get(documentId);
			return document?.workspaceId === tenantScopeId(scope) ? document : null;
		},
		async findGlobalByDocumentId(documentId) {
			return documents.get(documentId) ?? null;
		},
		async findByEntity(scope, kind, entityId) {
			return (
				Array.from(documents.values()).find(
					(document) =>
						document.workspaceId === tenantScopeId(scope) &&
						document.kind === kind &&
						document.entityId === entityId,
				) ?? null
			);
		},
		async listByKind(scope, kind) {
			return Array.from(documents.values()).filter(
				(document) =>
					document.workspaceId === tenantScopeId(scope) &&
					document.kind === kind,
			);
		},
		async createPending(scope, input) {
			const existing = await this.findByEntity(
				scope,
				input.kind,
				input.entityId,
			);
			if (existing) return existing;
			const now = new Date().toISOString();
			const document: CollaborativeDocument = {
				...input,
				workspaceId: tenantScopeId(scope),
				schemaVersion: input.schemaVersion ?? DOCUMENT_SCHEMA_VERSION,
				state: "pending",
				revision: 0,
				lastStateVector: null,
				seededAt: null,
				lastProjectedAt: null,
				lastError: null,
				createdAt: now,
				updatedAt: now,
			};
			documents.set(document.documentId, document);
			return document;
		},
		async claimSeed(scope, documentId, input) {
			const current = documents.get(documentId);
			if (
				!current ||
				current.workspaceId !== tenantScopeId(scope) ||
				current.revision !== input.expectedRevision
			) {
				return null;
			}
			const claimable =
				current.state === "pending" ||
				current.state === "error" ||
				(current.state === "seeding" &&
					current.updatedAt <= input.expiredBefore) ||
				(current.state === "ready" && input.allowReadyRepair);
			if (!claimable) return null;
			const claimed: CollaborativeDocument = {
				...current,
				state: "seeding",
				revision: current.revision + 1,
				lastError: null,
				updatedAt: new Date().toISOString(),
			};
			documents.set(documentId, claimed);
			return claimed;
		},
		async renewSeed(scope, documentId, input) {
			const current = await this.findByDocumentId(scope, documentId);
			if (
				current?.state !== "seeding" ||
				current.revision !== input.expectedRevision
			) {
				return false;
			}
			documents.set(documentId, {
				...current,
				updatedAt: new Date().toISOString(),
			});
			return true;
		},
		async markReady(scope, documentId, input) {
			const current = await this.findByDocumentId(scope, documentId);
			if (
				current?.state !== "seeding" ||
				current.revision !== input.expectedRevision
			) {
				return false;
			}
			const now = new Date().toISOString();
			documents.set(documentId, {
				...current,
				state: "ready",
				revision: current.revision + 1,
				lastStateVector: input.stateVector,
				seededAt: now,
				lastError: null,
				updatedAt: now,
			});
			return true;
		},
		async markProjected(scope, documentId, input) {
			const current = await this.findByDocumentId(scope, documentId);
			if (!current || current.revision !== input.expectedRevision) return false;
			const now = new Date().toISOString();
			documents.set(documentId, {
				...current,
				revision: current.revision + 1,
				lastStateVector: input.stateVector,
				lastProjectedAt: now,
				lastError: null,
				updatedAt: now,
			});
			return true;
		},
		async markError(scope, documentId, input) {
			const current = await this.findByDocumentId(scope, documentId);
			if (
				current?.state !== "seeding" ||
				current.revision !== input.expectedRevision
			) {
				return false;
			}
			documents.set(documentId, {
				...current,
				state: "error",
				lastError: input.message,
				updatedAt: new Date().toISOString(),
			});
			return true;
		},
		async recordTaskAttributions(scope, documentId, attributions) {
			const current = await this.findByDocumentId(scope, documentId);
			if (!current) throw new Error(`Unknown document ${documentId}`);
			const now = new Date().toISOString();
			for (const attribution of attributions) {
				const key = [
					documentId,
					attribution.blockId,
					attribution.assignee,
					attribution.actorUserId,
				].join(":");
				const existing = taskAttributions.get(key);
				taskAttributions.set(key, {
					id: existing?.id ?? crypto.randomUUID(),
					documentId,
					workspaceId: tenantScopeId(scope),
					...attribution,
					createdAt: existing?.createdAt ?? now,
					updatedAt: now,
				});
			}
		},
		async listTaskAttributions(scope, documentId) {
			return [...taskAttributions.values()]
				.filter(
					(attribution) =>
						attribution.workspaceId === tenantScopeId(scope) &&
						attribution.documentId === documentId,
				)
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		},
		async deleteTaskAttributions(scope, documentId, ids) {
			const idSet = new Set(ids);
			for (const [key, attribution] of taskAttributions) {
				if (
					attribution.workspaceId === tenantScopeId(scope) &&
					attribution.documentId === documentId &&
					idSet.has(attribution.id)
				) {
					taskAttributions.delete(key);
				}
			}
		},
		async deleteByEntities(scope, entities) {
			const deleted: string[] = [];
			for (const document of documents.values()) {
				if (
					document.workspaceId === tenantScopeId(scope) &&
					entities.some(
						(entity) =>
							entity.kind === document.kind &&
							entity.entityId === document.entityId,
					)
				) {
					documents.delete(document.documentId);
					for (const [key, attribution] of taskAttributions) {
						if (attribution.documentId === document.documentId) {
							taskAttributions.delete(key);
						}
					}
					deleted.push(document.documentId);
				}
			}
			return deleted;
		},
		async listPending(limit) {
			const expiredBefore = new Date(
				Date.now() - DOCUMENT_SEED_LEASE_MS,
			).toISOString();
			return Array.from(documents.values())
				.filter(
					(document) =>
						document.state === "pending" ||
						document.state === "error" ||
						(document.state === "seeding" &&
							document.updatedAt <= expiredBefore),
				)
				.slice(0, limit);
		},
	};
}
