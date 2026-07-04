import type { PageShare } from "@/features/shares/schemas";

export type NewPageShare = {
	pageId: string;
	workspaceId: string;
	token: string;
	createdBy: string;
};

export interface ShareRepository {
	findByPage(pageId: string): Promise<PageShare | null>;
	findByToken(token: string): Promise<PageShare | null>;
	create(input: NewPageShare): Promise<PageShare>;
	deleteByPage(pageId: string): Promise<void>;
}
