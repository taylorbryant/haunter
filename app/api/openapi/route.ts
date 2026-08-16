import { createOpenAPIHandler } from "@beignet/next";
import { env } from "@/lib/env";
import { getServer } from "@/server";

export async function GET(request: Request) {
	const server = await getServer();
	const handler = createOpenAPIHandler(server.contracts, {
		title: "Haunter API",
		version: "0.1.0",
		servers: [{ url: env.APP_URL }],
	});
	return handler(request);
}
