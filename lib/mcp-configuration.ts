import { env } from "@/lib/env";

const authBaseUrl = env.BETTER_AUTH_URL ?? env.APP_URL;

export const oauthIssuerUrl = new URL("/api/auth", authBaseUrl)
	.toString()
	.replace(/\/$/, "");

export const mcpResourceUrl =
	env.MCP_RESOURCE_URL ??
	new URL("/mcp", env.APP_URL).toString().replace(/\/$/, "");
