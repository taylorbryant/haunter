import type { TenantScope } from "@beignet/core/ports";
import type { PageShare } from "@/features/shares/schemas";

export type NewPageShare = {
	pageId: string;
	token: string;
	createdBy: string;
};

export interface ShareRepository {
	findByPage(scope: TenantScope, pageId: string): Promise<PageShare | null>;
	/** Capability lookup: the persisted row establishes the tenant scope. */
	findByToken(token: string): Promise<PageShare | null>;
	create(scope: TenantScope, input: NewPageShare): Promise<PageShare>;
	deleteByPage(scope: TenantScope, pageId: string): Promise<void>;
}
