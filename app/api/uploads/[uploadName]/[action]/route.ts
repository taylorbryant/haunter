import {
	createUploadRouter,
	defineUploads,
	uploadsFromRegistry,
} from "@beignet/core/uploads";
import { enforceUploadRateLimit } from "@/features/pages/lib/upload-rate-limit";
import { pageUploads } from "@/features/pages/uploads";
import { getServer } from "@/server";

const uploadRegistry = defineUploads({
	page: pageUploads,
});

type UploadAction = "prepare" | "complete" | "upload";

function firstParam(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
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
	const handler = server
		.rawRoute({
			name: "uploads",
			method: "POST",
			path: "/api/uploads/:uploadName/:action",
		})
		.handle(async ({ ctx }) => {
			const limited = await enforceUploadRateLimit(server, req, ctx);
			if (limited) return limited;

			const router = createUploadRouter({
				uploads: uploadsFromRegistry(uploadRegistry),
				ctx,
				storage: server.ports.storage,
			});

			return router.handleRequest(req, { uploadName, action });
		});

	return handler(req);
}
