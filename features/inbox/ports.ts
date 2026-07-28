import type { TenantScope } from "@beignet/core/ports";
import type { InboxItem } from "@/features/inbox/schemas";

export type InboxItemRecord = {
	id: string;
	userId: string;
	workspaceId: string;
	kind: "page" | "task";
	pageId: string | null;
	taskId: string | null;
	createdAt: string;
};

export type InboxCursor = {
	createdAt: string;
	id: string;
};

export type NewInboxItem =
	| {
			userId: string;
			kind: "page";
			pageId: string;
			taskId: null;
	  }
	| {
			userId: string;
			kind: "task";
			pageId: null;
			taskId: string;
	  };

export interface InboxRepository {
	listForUser(
		scope: TenantScope,
		userId: string,
		options: { limit: number; cursor?: InboxCursor },
	): Promise<{ items: InboxItem[]; nextCursor: InboxCursor | null }>;
	findForUser(
		scope: TenantScope,
		userId: string,
		id: string,
	): Promise<InboxItemRecord | null>;
	create(scope: TenantScope, input: NewInboxItem): Promise<InboxItemRecord>;
	deleteForUser(scope: TenantScope, userId: string, id: string): Promise<void>;
	deleteByPageIds(scope: TenantScope, pageIds: string[]): Promise<void>;
	deleteByTaskIds(scope: TenantScope, taskIds: string[]): Promise<void>;
}
