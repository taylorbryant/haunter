import "@beignet/core/server-only";
import { createAuthHooks } from "@beignet/core/server";
import type { AppContext } from "@/app-context";

/** HTTP authentication boundary; use cases still own business authorization. */
export const routeAuth = createAuthHooks<AppContext>()({
	resolve: ({ ctx }) => (ctx.auth ? { user: ctx.auth.user } : null),
});
