import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/core/server";
import type { AppContext } from "@/app-context";
import {
	createPage,
	deletePage,
	getPage,
	getPageVersion,
	listBacklinks,
	listPages,
	listPageVersions,
	listTrash,
	purgePage,
	restorePage,
	restorePageVersion,
	savePageContent,
	searchPages,
	updatePage,
} from "@/features/pages/contracts";
import {
	createPageUseCase,
	deletePageUseCase,
	getPageUseCase,
	getPageVersionUseCase,
	listBacklinksUseCase,
	listPagesUseCase,
	listPageVersionsUseCase,
	listTrashUseCase,
	purgePageUseCase,
	restorePageUseCase,
	restorePageVersionUseCase,
	savePageContentUseCase,
	searchPagesUseCase,
	updatePageUseCase,
} from "@/features/pages/use-cases";
import { routeAuth } from "@/server/auth-hooks";

export const pageRoutes = defineRouteGroup<AppContext>()({
	name: "pages",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: listPages, useCase: listPagesUseCase },
		{ contract: createPage, useCase: createPageUseCase },
		{ contract: getPage, useCase: getPageUseCase },
		{ contract: listBacklinks, useCase: listBacklinksUseCase },
		{ contract: updatePage, useCase: updatePageUseCase },
		{ contract: savePageContent, useCase: savePageContentUseCase },
		{ contract: searchPages, useCase: searchPagesUseCase },
		{ contract: deletePage, useCase: deletePageUseCase },
		{ contract: listTrash, useCase: listTrashUseCase },
		{ contract: restorePage, useCase: restorePageUseCase },
		{ contract: purgePage, useCase: purgePageUseCase },
		{ contract: listPageVersions, useCase: listPageVersionsUseCase },
		{ contract: getPageVersion, useCase: getPageVersionUseCase },
		{ contract: restorePageVersion, useCase: restorePageVersionUseCase },
	],
});
