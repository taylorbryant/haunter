import { auth } from "@/lib/better-auth";

/**
 * Agent Auth Protocol discovery document (§5.1). Agents fetch this to find
 * the provider's endpoints and capability catalog before registering.
 */
export async function GET(req: Request) {
	return Response.json(
		await auth.api.getAgentConfiguration({ headers: req.headers }),
	);
}
