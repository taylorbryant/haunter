import "@beignet/core/server-only";
import { createRoutes } from "@beignet/core/server";
import type { AppContext } from "@/app-context";

export const { defineRoute, defineRouteGroup } = createRoutes<AppContext>();
