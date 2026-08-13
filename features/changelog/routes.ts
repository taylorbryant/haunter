import "@beignet/core/server-only";
import {
	getChangelogStatus,
	markChangelogSeen,
} from "@/features/changelog/contracts";
import {
	getChangelogStatusUseCase,
	markChangelogSeenUseCase,
} from "@/features/changelog/use-cases";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";

export const changelogRoutes = defineRouteGroup({
	name: "changelog",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: getChangelogStatus, useCase: getChangelogStatusUseCase },
		{ contract: markChangelogSeen, useCase: markChangelogSeenUseCase },
	],
});
