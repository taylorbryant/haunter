import type { ActivityActor, ActivityTenant } from "@beignet/core/ports";
import type { TraceContext } from "@beignet/core/tracing";
import type { DevtoolsPort } from "@beignet/devtools";
import type { DbPort } from "@beignet/provider-db-drizzle/sqlite";
import type * as schema from "@/infra/db/schema";
import type { AppGate, AppPorts } from "@/ports";
import type { AuthSession } from "@/ports/auth";

/**
 * App ports plus the ports contributed by the server's providers at startup.
 */
export type AppRuntimePorts = AppPorts & {
	db: DbPort<typeof schema>;
	devtools: DevtoolsPort;
};

export type AppContext = {
	requestId: string;
	actor: ActivityActor;
	auth: AuthSession | null;
	gate: AppGate;
	ports: AppRuntimePorts;
	tenant?: ActivityTenant;
	membership?: Membership;
} & Partial<TraceContext>;

/** The caller's membership in the active workspace. */
export type Membership = {
	role: string;
};
