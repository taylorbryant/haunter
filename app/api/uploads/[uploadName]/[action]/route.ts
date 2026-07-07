import {
	createUploadRouter,
	defineUploads,
	uploadsFromRegistry,
} from "@beignet/core/uploads";
import type { AppContext } from "@/app-context";
import { pageUploads } from "@/features/pages/uploads";
import { getServer } from "@/server";

const uploadRegistry = defineUploads({
	page: pageUploads,
});

const UPLOAD_RATE_LIMIT = {
	limit: 120,
	windowSec: 60,
} as const;

type UploadAction = "prepare" | "complete" | "upload";

function firstParam(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function uploadRateLimitKey(req: Request, ctx: AppContext): string {
	const userId = ctx.auth?.user.id;
	if (userId) return `uploads:user:${userId}`;

	const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	const ip =
		forwardedFor || req.headers.get("x-real-ip")?.trim() || "unknown";
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

function uploadAction(value: string | undefined): UploadAction | null {
	return value === "prepare" || value === "complete" || value === "upload"
		? value
		: null;
}

export async function POST(
	req: Request,
	{
		params,
	}: {
		params: Promise<{
			uploadName?: string | string[];
			upload?: string | string[];
			action?: string | string[];
		}>;
	},
) {
	const resolvedParams = await params;
	const uploadName = firstParam(
		resolvedParams.uploadName ?? resolvedParams.upload,
	);
	const action = uploadAction(firstParam(resolvedParams.action));

	if (!uploadName) {
		return Response.json(
			{
				error: {
					code: "UPLOAD_NOT_FOUND",
					message: "Upload route is missing an upload name.",
				},
			},
			{ status: 404 },
		);
	}

	if (!action) {
		return Response.json(
			{
				error: {
					code: "INVALID_UPLOAD_ACTION",
					message:
						'Upload route action must be "prepare", "complete", or "upload".',
				},
			},
			{ status: 400 },
		);
	}

	const server = await getServer();
	const ctx = await server.createContextFromNext();
	const limited = await enforceUploadRateLimit(server, req, ctx);
	if (limited) return limited;

	const router = createUploadRouter({
		uploads: uploadsFromRegistry(uploadRegistry),
		ctx,
		storage: server.ports.storage,
	});

	return router.handleRequest(req, { uploadName, action });
}
