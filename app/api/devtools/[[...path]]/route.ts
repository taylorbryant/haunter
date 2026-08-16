import { createDevtoolsRoute } from "@beignet/devtools";
import { env } from "@/lib/env";
import { ADMIN_ROLE } from "@/ports/auth";
import { getServer } from "@/server";

// Build the devtools route on first request so importing this module during
// a Next build never boots the server. getServer memoizes, so this promise
// resolves once and is reused.
let routePromise: ReturnType<typeof buildRoute> | undefined;

async function buildRoute() {
	const server = await getServer();
	return createDevtoolsRoute(server.ports.devtools, {
		basePath: "/api/devtools",
		enabled: env.DEVTOOLS_ENABLED,
		authorize: async (request) => {
			const session = await server.ports.auth.getSession(request);
			return session?.user.role === ADMIN_ROLE;
		},
	});
}

function devtoolsRoute() {
	routePromise ??= buildRoute();
	return routePromise;
}

export async function GET(request: Request) {
	return (await devtoolsRoute()).GET(request);
}

export async function POST(request: Request) {
	return (await devtoolsRoute()).POST(request);
}
