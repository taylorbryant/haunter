import "@beignet/core/server-only";
import {
	captureInboxItem,
	listInboxItems,
	resolveInboxItem,
} from "@/features/inbox/contracts";
import {
	captureInboxItemUseCase,
	listInboxItemsUseCase,
	resolveInboxItemUseCase,
} from "@/features/inbox/use-cases";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/server/auth-hooks";

export const inboxRoutes = defineRouteGroup({
	name: "inbox",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: listInboxItems, useCase: listInboxItemsUseCase },
		{ contract: captureInboxItem, useCase: captureInboxItemUseCase },
		{ contract: resolveInboxItem, useCase: resolveInboxItemUseCase },
	],
});
