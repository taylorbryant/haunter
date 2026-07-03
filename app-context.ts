import type { ActivityActor, ActivityTenant } from "@beignet/core/ports";
import type { InferProviderPorts } from "@beignet/core/providers";
import type { TraceContext } from "@beignet/core/tracing";
import type { AppGate, AppPorts } from "@/ports";
import type { AuthSession } from "@/ports/auth";
import type { providers } from "@/server/providers";

/**
 * App ports plus the ports contributed by the server's providers at startup.
 */
export type AppRuntimePorts = AppPorts & InferProviderPorts<typeof providers>;

export type AppContext = {
	requestId: string;
	actor: ActivityActor;
	auth: AuthSession | null;
	gate: AppGate;
	ports: AppRuntimePorts;
	tenant?: ActivityTenant;
} & Partial<TraceContext>;
