import { env } from "@/lib/env";

export function GET() {
	return Response.json(
		{
			status: "ok",
			environment: env.NODE_ENV,
			timestamp: new Date().toISOString(),
		},
		{
			headers: {
				"cache-control": "no-store",
			},
		},
	);
}
