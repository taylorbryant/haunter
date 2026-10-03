import { z } from "zod";

export const COMPANION_URI = "ui://haunter/workspace/v1";
export const PAGE_RESOURCE_TEMPLATE =
	"haunter://workspaces/{workspaceId}/pages/{pageId}";
export const MAX_CONTEXT_CHARACTERS = 60_000;
export const MAX_MENTION_RESULTS = 20;

const WorkspaceIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const WorkspaceListSchema = z.object({
	workspaces: z.array(
		z.object({ id: WorkspaceIdSchema, name: z.string(), role: z.string() }),
	),
});
export type CompanionWorkspace = z.infer<
	typeof WorkspaceListSchema
>["workspaces"][number];

export const PageListSchema = z.object({
	pages: z.array(
		z.object({
			pageId: z.uuid(),
			title: z.string(),
			icon: z.string().nullable().optional(),
			parentPageId: z.uuid().nullable().optional(),
			updatedAt: z.string().optional(),
		}),
	),
});
export type CompanionPageItem = z.infer<typeof PageListSchema>["pages"][number];
export const CompanionPageSchema = z.object({
	pageId: z.uuid(),
	title: z.string(),
	updatedAt: z.string(),
	revision: z.string().min(1).max(200),
	markdown: z.string(),
});
export type CompanionPage = z.infer<typeof CompanionPageSchema>;

export const ContextPageSchema = CompanionPageSchema.omit({
	markdown: true,
}).extend({ workspaceId: WorkspaceIdSchema });
export type ContextPage = z.infer<typeof ContextPageSchema>;

export function pageResourceUri(workspaceId: string, pageId: string) {
	WorkspaceIdSchema.parse(workspaceId);
	z.uuid().parse(pageId);
	return `haunter://workspaces/${workspaceId}/pages/${pageId}`;
}

export function parsePageResourceUri(uri: string) {
	const match = /^haunter:\/\/workspaces\/([^/]+)\/pages\/([^/]+)$/.exec(uri);
	if (!match) throw new Error("Invalid Haunter page resource.");
	return {
		workspaceId: WorkspaceIdSchema.parse(match[1]),
		pageId: z.uuid().parse(match[2]),
	};
}

/** A bounded snapshot, with a source URI and an explicit truncation marker. */
export function pageContextText(
	workspace: Pick<CompanionWorkspace, "id" | "name">,
	page: CompanionPage,
) {
	const truncated = page.markdown.length > MAX_CONTEXT_CHARACTERS;
	const body = truncated
		? `${page.markdown.slice(0, MAX_CONTEXT_CHARACTERS)}\n\n[Page truncated. Read the source resource for the complete page.]`
		: page.markdown;
	return [
		`Haunter page: ${page.title}`,
		`Workspace: ${workspace.name}`,
		`Source: ${pageResourceUri(workspace.id, page.pageId)}`,
		`Revision: ${page.revision}`,
		`Updated: ${page.updatedAt}`,
		"",
		body,
	].join("\n");
}
