import "@beignet/core/server-only";
import type { ServerHook } from "@beignet/core/server";
import type { AppContext } from "@/app-context";
import {
	listPages,
	getPageNavigation,
	searchPages,
	createPage,
	deletePage,
	restorePage,
	listTrash,
	setPageFavorite,
	getPage,
	getPageMetadata,
	recordPageView,
	updatePage,
	listPageVersions,
	getPageVersion,
	restorePageVersion,
} from "@/features/pages/contracts";
import {
	getCanvas,
	listCanvases,
	getCanvasNavigation,
	createCanvas,
	updateCanvas,
	recordCanvasView,
	setCanvasFavorite,
} from "@/features/canvases/contracts";
import {
	openCanvasSession,
	openDocumentSession,
	importRecovery,
} from "@/features/documents/contracts";
import {
	getPageShare,
	createPageShare,
	revokePageShare,
} from "@/features/shares/contracts";
import {
	exchangeEmbeddedEditor,
	verifyEmbeddedEditor,
	listEmbeddedWorkspaces,
	getEmbeddedAppearance,
	updateEmbeddedAppearance,
} from "@/features/agents/contracts";
import { searchWorkspace } from "@/features/search/contracts";
import { appError } from "@/features/shared/errors";
import { canAccessEmbeddedCanvas } from "@/features/agents/embedded-editor-session";
import { requireActiveWorkspaceScope } from "@/lib/auth";

import { listWorkspaceMembers } from "@/features/members/contracts";
import {
	listTasks,
	createTask,
	updateTask,
	deleteTask,
} from "@/features/tasks/contracts";

/** Explicit workspace grants use a limited API surface; legacy document grants stay document-scoped. */
export const embeddedEditorAuthHooks: ServerHook<AppContext> = {
	async beforeHandle({ ctx, contract, path, body, req }) {
		if (!ctx.embeddedEditor) return;
		const grant = ctx.embeddedEditor;
		if (contract.name === verifyEmbeddedEditor.name) return;
		// These raw routes perform their own page-scoped authorization. Embedded
		// uploads use server multipart only; no direct-storage credentials are issued.
		if (contract.name === "pageAttachment.read") return;
		if (
			contract.name === "uploads" &&
			grant.scope === "workspace" &&
			grant.role !== "viewer" &&
			new URL(req.url).pathname === "/api/uploads/pages.attachment/upload"
		)
			return;
		if (grant.scope === "workspace") {
			// A viewer can save their own appearance; this grants no content writes.
			if (
				[getEmbeddedAppearance.name, updateEmbeddedAppearance.name].includes(
					contract.name,
				)
			)
				return;
			const reads = [
				listEmbeddedWorkspaces,
				listTasks,
				listWorkspaceMembers,
				listPages,
				getPageNavigation,
				searchPages,
				searchWorkspace,
				getPage,
				getPageMetadata,
				listPageVersions,
				getPageVersion,
				getPageShare,
				getCanvas,
				listCanvases,
				getCanvasNavigation,
				listTrash,
				recordPageView,
				recordCanvasView,
				openDocumentSession,
				openCanvasSession,
			];
			const writes = [
				createTask,
				updateTask,
				deleteTask,
				createPage,
				updatePage,
				deletePage,
				restorePage,
				restorePageVersion,
				importRecovery,
				createPageShare,
				revokePageShare,
				setPageFavorite,
				createCanvas,
				updateCanvas,
				setCanvasFavorite,
			];
			if (
				!reads.some((entry) => entry.name === contract.name) &&
				!(
					grant.role !== "viewer" &&
					writes.some((entry) => entry.name === contract.name)
				)
			)
				throw appError("Forbidden");
			// All feature use cases still resolve resource IDs against the session's tenant.
			const workspaceId =
				(path as { workspaceId?: string })?.workspaceId ??
				(body as { workspaceId?: string })?.workspaceId;
			if (workspaceId && workspaceId !== grant.workspaceId)
				throw appError("Forbidden");
			return;
		}
		if (grant.canvasId) {
			if (
				![getCanvas.name, openCanvasSession.name].includes(contract.name) ||
				(path as { id?: string } | undefined)?.id !== grant.canvasId
			)
				throw appError("Forbidden");
			return;
		}
		if ([getCanvas.name, openCanvasSession.name].includes(contract.name)) {
			const id = (path as { id?: string } | undefined)?.id;
			const canvas = id
				? await ctx.ports.canvases.findMetaById(
						requireActiveWorkspaceScope(ctx),
						id,
					)
				: null;
			if (!canvas || !canAccessEmbeddedCanvas(grant, canvas))
				throw appError("Forbidden");
			return;
		}
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
