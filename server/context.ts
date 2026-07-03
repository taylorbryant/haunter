import "@beignet/core/server-only";
import {
	type ActivityActor,
	createAnonymousActor,
	createServiceActor,
	createUserActor,
} from "@beignet/core/ports";
import { defineServerContext } from "@beignet/core/server";
import type { TraceContext } from "@beignet/core/tracing";
import type { AppContext, AppRuntimePorts } from "@/app-context";
import { resolveRequestTenant, resolveServiceTenant } from "@/lib/tenant";

export type AppServiceContextInput =
	| {
			actor?: ActivityActor;
			tenantId?: string;
	  }
	| undefined;

/**
 * Context blueprint shared by the runtime server and route tests.
 */
export const appContext = defineServerContext<AppContext, AppRuntimePorts>()({
	gate: (ports) => ports.gate,
	request: async ({ req, ports, requestId, trace }) => {
		const auth = await ports.auth.getSession(req);
		const tenant = resolveRequestTenant({ auth });

		return {
			requestId,
			actor: auth
				? createUserActor(auth.user.id, { displayName: auth.user.name })
				: createAnonymousActor(),
			auth,
			...trace,
			ports,
			...(tenant ? { tenant } : {}),
		};
	},
	service: ({
		ports,
		input,
		requestId,
		trace,
	}: {
		ports: AppRuntimePorts;
		input: AppServiceContextInput;
		requestId: string;
		trace: TraceContext;
	}) => {
		const tenant = resolveServiceTenant(input?.tenantId);

		return {
			requestId,
			actor: input?.actor ?? createServiceActor("beignet-service"),
			auth: null,
			...trace,
			ports,
			...(tenant ? { tenant } : {}),
		};
	},
});
