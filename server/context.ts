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
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";

export type AppServiceContextInput =
	| {
			actor?: ActivityActor;
			tenantId?: string;
			/**
			 * Impersonate a user for non-HTTP entrypoints (agent capabilities,
			 * scripts). The caller is responsible for verifying the role against
			 * the database first — this input is trusted as already verified.
			 */
			asUser?: { id: string; role: string; name?: string };
	  }
	| undefined;

/**
 * Context blueprint shared by the runtime server and route tests.
 */
export const appContext = defineServerContext<AppContext, AppRuntimePorts>()({
	gate: (ports) => ports.gate,
	request: async ({ req, ports, requestId, trace }) => {
		const auth = await ports.auth.getSession(req);
		const requestedTenant = resolveRequestTenant({ auth });
		// The active organization is only a selector. A current Better Auth member
		// row is the proof that lets request code receive tenant-scoped ports.
		const role =
			auth && requestedTenant
				? await ports.members.findRole(requestedTenant.id, auth.user.id)
				: null;
		const tenant = role ? requestedTenant : undefined;

		return {
			requestId,
			actor: auth
				? createUserActor(auth.user.id, { displayName: auth.user.name })
				: createAnonymousActor(),
			auth,
			...trace,
			ports,
			...(tenant ? { tenant } : {}),
			...(role ? { membership: { role } } : {}),
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

		// Impersonation: mirror the request context's shape so gate policies
		// (tenant match, viewer read-only) apply to agents and scripts exactly
		// as they do to signed-in members.
		if (input?.asUser) {
			return {
				requestId,
				actor: createUserActor(input.asUser.id, {
					...(input.asUser.name ? { displayName: input.asUser.name } : {}),
				}),
				// Synthetic session: requireUser() only needs the acting user's
				// verified identity.
				auth: {
					user: { id: input.asUser.id, accessStatus: ACCESS_STATUS_APPROVED },
					session: {
						...(input.tenantId ? { activeOrganizationId: input.tenantId } : {}),
					},
				},
				...trace,
				ports,
				...(tenant ? { tenant } : {}),
				membership: { role: input.asUser.role },
			};
		}

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
