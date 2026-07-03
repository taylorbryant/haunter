import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/next";
import type { AppContext } from "@/app-context";
import {
	createPage,
	deletePage,
	getPage,
	listBacklinks,
	listPages,
	listTrash,
	purgePage,
	restorePage,
	savePageContent,
	searchPages,
	updatePage,
} from "@/features/pages/contracts";
import {
	createPageUseCase,
	deletePageUseCase,
	getPageUseCase,
	listBacklinksUseCase,
	listPagesUseCase,
	listTrashUseCase,
	purgePageUseCase,
	restorePageUseCase,
	savePageContentUseCase,
	searchPagesUseCase,
	updatePageUseCase,
} from "@/features/pages/use-cases";

export const pageRoutes = defineRouteGroup<AppContext>()({
	name: "pages",
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
	],
});
