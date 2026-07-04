import { getServer } from "@/server";

/**
 * Serve private storage objects back to workspace members. Upload keys are
 * namespaced pages/<workspaceId>/..., so access is checked by matching the
 * caller's active workspace against the key; everything else (missing,
 * foreign, invalid) is a uniform 404.
 */
export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ key: string[] }> },
) {
	const { key: segments } = await params;
	const server = await getServer();
	const ctx = await server.createContextFromNext();
	const workspaceId = ctx.tenant?.id;
	if (!ctx.auth?.user.id || !workspaceId) {
		return new Response(null, { status: 404 });
	}

	const key = segments.join("/");
	if (!key.startsWith(`pages/${workspaceId}/`)) {
		return new Response(null, { status: 404 });
	}

	const object = await server.ports.storage.get(key);
	if (!object) {
		return new Response(null, { status: 404 });
	}

	return new Response(object.stream(), {
		headers: {
			"content-type": object.contentType ?? "application/octet-stream",
			"content-length": String(object.size),
			"cache-control": object.cacheControl ?? "private, max-age=0",
		},
	});
}
