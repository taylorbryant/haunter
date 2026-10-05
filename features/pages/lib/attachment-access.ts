import "@beignet/core/server-only";
import { assertValidStorageKey } from "@beignet/core/ports";
import type { AppContext } from "@/app-context";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";

/** Check the source page as well as the workspace, including document-scoped embed grants. */
export async function canReadAttachment(
	ctx: AppContext,
	key: string,
): Promise<boolean> {
	requireUser(ctx);
	const scope = requireActiveWorkspaceScope(ctx);
	try {
		assertValidStorageKey(key);
	} catch {
		return false;
	}
	const prefix = `pages/${ctx.tenant?.id}/`;
	if (!key.startsWith(prefix)) return false;
	const [pageId, object, ...extra] = key.slice(prefix.length).split("/");
	if (!pageId || !object || extra.length || !/^[0-9a-f-]{36}$/i.test(pageId))
		return false;
	const grant = ctx.embeddedEditor;
	if (
		grant &&
		(grant.workspaceId !== ctx.tenant?.id ||
			(grant.scope !== "workspace" &&
				(grant.canvasId || grant.pageId !== pageId)))
	)
		return false;
	const page = await ctx.ports.pages.findMetaById(scope, pageId);
	return (
		!!page &&
		page.deletedAt === null &&
		(await ctx.gate.inspect("pages.read", page)).allowed
	);
}
