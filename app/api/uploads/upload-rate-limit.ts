import type { AppContext } from "@/app-context";
import type { getServer } from "@/server";

const UPLOAD_RATE_LIMIT = {
	limit: 120,
	windowSec: 60,
} as const;

function uploadRateLimitKey(req: Request, ctx: AppContext): string {
	const userId = ctx.auth?.user.id;
	if (userId) return `uploads:user:${userId}`;

	const forwardedFor = req.headers
		.get("x-forwarded-for")
		?.split(",")[0]
		?.trim();
	const ip = forwardedFor || req.headers.get("x-real-ip")?.trim() || "unknown";
	return `uploads:ip:${ip}`;
}

export async function enforceUploadRateLimit(
	server: Pick<Awaited<ReturnType<typeof getServer>>, "ports">,
	req: Request,
	ctx: AppContext,
): Promise<Response | null> {
	const limit = await server.ports.rateLimit.hit({
		key: uploadRateLimitKey(req, ctx),
		limit: UPLOAD_RATE_LIMIT.limit,
		windowSec: UPLOAD_RATE_LIMIT.windowSec,
	});
	if (limit.allowed) return null;

	return Response.json(
		{
			error: {
				code: "TOO_MANY_REQUESTS",
				message: "Too many upload requests.",
			},
		},
		{
			status: 429,
			headers: limit.retryAfterSeconds
				? { "retry-after": String(limit.retryAfterSeconds) }
				: {},
		},
	);
}
