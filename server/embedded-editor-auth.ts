import "@beignet/core/server-only";
import type { ServerHook } from "@beignet/core/server";
import type { AppContext } from "@/app-context";
import {
	getPage,
	getPageMetadata,
	recordPageView,
	updatePage,
} from "@/features/pages/contracts";
import { openDocumentSession } from "@/features/documents/contracts";
import {
	exchangeEmbeddedEditor,
	verifyEmbeddedEditor,
} from "@/features/agents/contracts";
import { appError } from "@/features/shared/errors";

/** A verified embedded identity still has authority over only one page. */
export const embeddedEditorAuthHooks: ServerHook<AppContext> = {
	beforeHandle({ ctx, contract, path, body }) {
		if (!ctx.embeddedEditor) return;
		const grant = ctx.embeddedEditor;
		if (contract.name === verifyEmbeddedEditor.name) return;
		const allowed = [
			getPage,
			getPageMetadata,
			recordPageView,
			updatePage,
			openDocumentSession,
		].some((candidate) => candidate.name === contract.name);
		if (!allowed || (path as { id?: string } | undefined)?.id !== grant.pageId)
			throw appError("Forbidden");
		if (contract.name === updatePage.name) {
			if (
				grant.role === "viewer" ||
				Object.keys(body ?? {}).some(
					(key) => !["title", "baseTitle", "icon"].includes(key),
				)
			)
				throw appError("Forbidden");
		}
	},
	beforeSend({ req, ctx, contract, response }) {
		if (
			ctx?.embeddedEditor ||
			contract.name === exchangeEmbeddedEditor.name ||
			req.headers.get("authorization")?.toLowerCase().startsWith("haunterembed")
		)
			return {
				...response,
				headers: { ...response.headers, "Cache-Control": "no-store" },
			};
	},
};
