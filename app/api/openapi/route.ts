import { createOpenAPIHandler } from "@beignet/next";
import { env } from "@/lib/env";
import { server } from "@/server";

export const GET = createOpenAPIHandler(server.contracts, {
	title: "Beignet starter API",
	version: "0.1.0",
	servers: [{ url: env.APP_URL }],
});
