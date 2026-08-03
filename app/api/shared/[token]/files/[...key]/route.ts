import { createTenant, createTenantScope } from "@beignet/core/ports";
import { isDocumentStoreUnavailable } from "@/features/documents/errors";
import { readCollaborativePageProjection } from "@/features/documents/service";
import { contentReferencesFileKey } from "@/features/shares/lib/file-keys";
import {
	enforceSharedFileRateLimit,
	enforceSharedFileTokenRateLimit,
} from "@/features/shares/lib/shared-file-rate-limit";
import { sharedFileHeaders } from "@/features/shares/lib/shared-file-response";
import { getServer } from "@/server";

/**
 * Serve files embedded in a shared page to anonymous visitors. The share
 * token is the authorization; it only reaches objects under the shared
 * page's own key prefix (pages/<workspaceId>/<pageId>/...), so a token never
 * unlocks the rest of the workspace's storage. Everything else — revoked
 * token, trashed page, foreign key — is a uniform 404.
 */
export async function GET(
	req: Request,
	{ params }: { params: Promise<{ token: string; key: string[] }> },
) {
	const { token, key: segments } = await params;
	const server = await getServer();

	// This route bypasses the contract hooks, so enforce the limit manually.
	// Key by IP before lookup so invalid-token sprays cannot bypass rate limits.
	const limited = await enforceSharedFileRateLimit(server, req);
	if (limited) return limited;

	const share = await server.ports.shares.findByToken(token);
	if (!share) {
		return new Response(null, { status: 404 });
	}
	const tokenLimited = await enforceSharedFileTokenRateLimit(server, token);
	if (tokenLimited) return tokenLimited;

	// The persisted capability, not request input, establishes this scope.
	const scope = createTenantScope(createTenant(share.workspaceId));
	const page = await server.ports.pages.findById(scope, share.pageId);
	if (!page || page.deletedAt !== null) {
		return new Response(null, { status: 404 });
	}

	const key = segments.join("/");
	if (!key.startsWith(`pages/${share.workspaceId}/${share.pageId}/`)) {
		return new Response(null, { status: 404 });
	}
	let content = page.content;
	try {
		content = (
			await readCollaborativePageProjection({
				scope,
				entityId: page.id,
				ports: server.ports,
			})
		).content;
	} catch (error) {
		if (!isDocumentStoreUnavailable(error)) throw error;
		server.ports.logger.warn(
			"Serving a file from a stale page projection while the document store is unavailable",
			{ error, pageId: page.id },
		);
	}
	if (!contentReferencesFileKey(content, key)) {
		return new Response(null, { status: 404 });
	}

	const object = await server.ports.storage.get(key);
	if (!object) {
		return new Response(null, { status: 404 });
	}

	return new Response(object.stream(), {
		headers: sharedFileHeaders(object),
	});
}
