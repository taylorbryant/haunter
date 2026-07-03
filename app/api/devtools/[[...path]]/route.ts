import { createDevtoolsRoute } from "@beignet/devtools";
import { env } from "@/lib/env";
import { server } from "@/server";

export const { GET, POST } = createDevtoolsRoute(server.ports.devtools, {
	basePath: "/api/devtools",
	enabled: env.DEVTOOLS_ENABLED,
});
