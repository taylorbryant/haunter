import { type ActivityTenant, createTenant } from "@beignet/core/ports";
import type { AuthSession } from "@/ports/auth";

export type TenantResolutionInput = {
	auth: AuthSession | null;
};

export function resolveRequestTenant({
	auth,
}: TenantResolutionInput): ActivityTenant | undefined {
	const tenantId = auth ? tenantIdFromAuth(auth) : undefined;

	return tenantId ? createTenant(tenantId) : undefined;
}

export function resolveServiceTenant(
	tenantId: string | undefined,
): ActivityTenant | undefined {
	const normalizedTenantId = normalizeTenantId(tenantId);

	return normalizedTenantId ? createTenant(normalizedTenantId) : undefined;
}

function tenantIdFromAuth(auth: AuthSession) {
	return (
		stringProperty(auth.session, "tenantId") ??
		stringProperty(auth.session, "organizationId") ??
		stringProperty(auth.user, "tenantId") ??
		stringProperty(auth.user, "organizationId")
	);
}

function stringProperty(value: unknown, key: string) {
	if (!isRecord(value)) return undefined;

	return normalizeTenantId(value[key]);
}

function normalizeTenantId(value: unknown) {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
