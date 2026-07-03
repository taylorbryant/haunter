import { getServer } from "@/server";

/**
 * Serve private storage objects back to their owner. Upload keys are
 * namespaced pages/<userId>/..., so ownership is checked from the key
 * itself; everything else (missing, foreign, invalid) is a uniform 404.
 */
export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ key: string[] }> },
) {
	const { key: segments } = await params;
	const server = await getServer();
	const ctx = await server.createContextFromNext();
	const userId = ctx.auth?.user.id;
	if (!userId) {
		return new Response(null, { status: 404 });
	}

	const key = segments.join("/");
	if (!key.startsWith(`pages/${userId}/`)) {
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
