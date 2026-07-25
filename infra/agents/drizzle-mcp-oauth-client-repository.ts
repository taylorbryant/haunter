import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import {
	and,
	count,
	eq,
	inArray,
	isNull,
	lt,
	notExists,
	or,
	sql,
} from "drizzle-orm";
import type { McpOAuthClientRepository } from "@/features/agents/ports";
import * as schema from "@/infra/db/schema";
import {
	OAUTH_DCR_ALLOCATION_MARKER_PREFIX,
	OAUTH_DCR_ALLOCATION_METADATA_KEY,
} from "@/lib/oauth-dcr-request";

function isLoopbackIp(hostname: string) {
	if (hostname === "::1" || hostname === "[::1]") return true;
	const octets = hostname.split(".");
	return (
		octets.length === 4 &&
		octets[0] === "127" &&
		octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
	);
}

function redirectMatches(registeredValue: string, requestedValue: string) {
	if (registeredValue === requestedValue) return true;
	try {
		const registered = new URL(registeredValue);
		const requested = new URL(requestedValue);
		return (
			isLoopbackIp(registered.hostname) &&
			registered.hostname === requested.hostname &&
			registered.protocol === requested.protocol &&
			registered.pathname === requested.pathname &&
			registered.search === requested.search
		);
	} catch {
		return false;
	}
}

function parseStringArray(value: unknown): string[] | null {
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
		return value;
	}
	if (typeof value !== "string") return null;
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) &&
			parsed.every((item) => typeof item === "string")
			? parsed
			: null;
	} catch {
		return null;
	}
}

export function createDrizzleMcpOAuthClientRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): McpOAuthClientRepository {
	function dynamicAllocationMarker() {
		return sql<string | null>`
			CASE
				WHEN ${schema.oauthClient.metadata} IS NULL
					OR json_valid(${schema.oauthClient.metadata}) = 0
					THEN NULL
				WHEN json_type(${schema.oauthClient.metadata}) = 'object'
					THEN json_extract(
						${schema.oauthClient.metadata},
						${`$.${OAUTH_DCR_ALLOCATION_METADATA_KEY}`}
					)
				WHEN json_type(${schema.oauthClient.metadata}) = 'text'
					THEN CASE
						WHEN json_valid(json_extract(${schema.oauthClient.metadata}, '$')) = 1
							THEN json_extract(
								json_extract(${schema.oauthClient.metadata}, '$'),
								${`$.${OAUTH_DCR_ALLOCATION_METADATA_KEY}`}
							)
						ELSE NULL
					END
				ELSE NULL
			END
		`;
	}

	function isDynamicClient(allocationKey?: string) {
		if (!allocationKey) {
			// This OAuth provider exists only for hosted MCP clients. Treating
			// every client row as lifecycle-managed also bounds legacy/session
			// registrations that predate the server-owned allocation marker.
			return sql`1 = 1`;
		}
		const marker = dynamicAllocationMarker();
		return sql`${marker} = ${
			OAUTH_DCR_ALLOCATION_MARKER_PREFIX + allocationKey
		}`;
	}

	function hasNoAuthorizationMaterial() {
		return and(
			notExists(
				db
					.select({ id: schema.oauthConsent.id })
					.from(schema.oauthConsent)
					.where(eq(schema.oauthConsent.clientId, schema.oauthClient.clientId)),
			),
			notExists(
				db
					.select({ id: schema.oauthAccessToken.id })
					.from(schema.oauthAccessToken)
					.where(
						eq(schema.oauthAccessToken.clientId, schema.oauthClient.clientId),
					),
			),
			notExists(
				db
					.select({ id: schema.oauthRefreshToken.id })
					.from(schema.oauthRefreshToken)
					.where(
						eq(schema.oauthRefreshToken.clientId, schema.oauthClient.clientId),
					),
			),
			notExists(
				db
					.select({ id: schema.mcpConnection.id })
					.from(schema.mcpConnection)
					.where(
						and(
							eq(schema.mcpConnection.clientId, schema.oauthClient.clientId),
							eq(schema.mcpConnection.status, "active"),
						),
					),
			),
		);
	}

	function isUnusedDynamicClient(allocationKey?: string) {
		return and(isDynamicClient(allocationKey), hasNoAuthorizationMaterial());
	}

	return {
		async findForConsent(input) {
			const [client] = await db
				.select({
					clientId: schema.oauthClient.clientId,
					clientName: schema.oauthClient.name,
					clientUri: schema.oauthClient.uri,
					redirectUris: schema.oauthClient.redirectUris,
				})
				.from(schema.oauthClient)
				.where(
					and(
						eq(schema.oauthClient.clientId, input.clientId),
						or(
							eq(schema.oauthClient.disabled, false),
							isNull(schema.oauthClient.disabled),
						),
					),
				)
				.limit(1);
			const redirectUris = parseStringArray(client?.redirectUris);
			if (
				!client ||
				!redirectUris?.some((uri) => redirectMatches(uri, input.redirectUri))
			) {
				return null;
			}
			return {
				clientId: client.clientId,
				clientName: client.clientName,
				clientUri: client.clientUri,
				redirectUri: input.redirectUri,
				// DCR names, icons, and websites are self-asserted. A future
				// trusted-client registry can make this true for reviewed clients.
				identityVerified: false,
			};
		},

		async countUnusedDynamic(allocationKey) {
			const [row] = await db
				.select({ value: count() })
				.from(schema.oauthClient)
				.where(isUnusedDynamicClient(allocationKey));
			return row?.value ?? 0;
		},

		async retireUnusedDynamicBefore(cutoff, limit) {
			const candidates = await db
				.select({ clientId: schema.oauthClient.clientId })
				.from(schema.oauthClient)
				.where(
					and(
						isUnusedDynamicClient(),
						lt(schema.oauthClient.createdAt, cutoff),
					),
				)
				.limit(Math.max(0, limit));
			const clientIds = candidates.map((candidate) => candidate.clientId);
			if (clientIds.length === 0) return 0;

			// Re-evaluate the safety predicate at deletion time so a concurrent
			// consent/token write always wins over cleanup.
			const deleted = await db
				.delete(schema.oauthClient)
				.where(
					and(
						inArray(schema.oauthClient.clientId, clientIds),
						isUnusedDynamicClient(),
						lt(schema.oauthClient.createdAt, cutoff),
					),
				)
				.returning({ clientId: schema.oauthClient.clientId });
			return deleted.length;
		},
	};
}
