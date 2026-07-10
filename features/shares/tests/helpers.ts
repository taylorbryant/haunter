import type { NewPageShare, ShareRepository } from "@/features/shares/ports";
import type { PageShare } from "@/features/shares/schemas";

export function createTestShareRepository(): ShareRepository {
	const shares = new Map<string, PageShare>();

	return {
		async findByPage(scope, pageId: string) {
			return (
				Array.from(shares.values()).find(
					(share) =>
						share.workspaceId === tenantScopeId(scope) &&
						share.pageId === pageId,
				) ?? null
			);
		},
		async findByToken(token: string) {
			return (
				Array.from(shares.values()).find((share) => share.token === token) ??
				null
			);
		},
		async create(scope, input: NewPageShare) {
			const share: PageShare = {
				id: crypto.randomUUID(),
				pageId: input.pageId,
				workspaceId: tenantScopeId(scope),
				token: input.token,
				createdBy: input.createdBy,
				createdAt: new Date().toISOString(),
			};
			shares.set(share.id, share);
			return share;
		},
		async deleteByPage(scope, pageId: string) {
			for (const share of Array.from(shares.values())) {
				if (
					share.workspaceId === tenantScopeId(scope) &&
					share.pageId === pageId
				) {
					shares.delete(share.id);
				}
			}
		},
	};
}
import { tenantScopeId } from "@beignet/core/ports";
