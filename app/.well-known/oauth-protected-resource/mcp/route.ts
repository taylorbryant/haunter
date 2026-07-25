import { generateProtectedResourceMetadata } from "mcp-handler";
import { mcpResourceUrl, oauthIssuerUrl } from "@/lib/better-auth";
import { REMOTE_MCP_SCOPES } from "@/server/remote-mcp";

export function GET() {
	return Response.json(
		generateProtectedResourceMetadata({
			authServerUrls: [oauthIssuerUrl],
			resourceUrl: mcpResourceUrl,
			additionalMetadata: {
				resource_name: "Haunter",
				scopes_supported: [...REMOTE_MCP_SCOPES],
				bearer_methods_supported: ["header"],
			},
		}),
		{
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Cache-Control": "public, max-age=300",
			},
		},
	);
}
