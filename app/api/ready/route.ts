import { createHealthHandler } from "@beignet/core/server";
import { env } from "@/lib/env";
import { server } from "@/server";

const readiness = createHealthHandler(
	server.ports,
	{
		checks: {
			database: (ports) => ports.db.checkHealth(),
		},
		timeoutMs: 2000,
	},
	env.NODE_ENV,
);

export async function GET(request: Request) {
	const response = await readiness(request);

	return Response.json(response.body, {
		status: response.status,
		headers: {
			...response.headers,
			"cache-control": "no-store",
		},
	});
}
