import "@beignet/core/server-only";
import {
	GetMcpConsentContextInputSchema,
	McpConsentContextSchema,
} from "@/features/agents/schemas";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

function safeExternalUrl(value: string | null) {
	if (!value) return null;
	try {
		const url = new URL(value);
		return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
	} catch {
		return null;
	}
}

export const getMcpConsentContextUseCase = useCase
	.query("agents.getMcpConsentContext")
	.input(GetMcpConsentContextInputSchema)
	.output(McpConsentContextSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);
		const oauthRequest = await ctx.ports.mcpOAuthRequests.verify(
			input.oauthQuery,
		);
		if (!oauthRequest) throw appError("McpClientNotFound");

		const client = await ctx.ports.mcpOAuthClients.findForConsent(oauthRequest);
		if (!client) throw appError("McpClientNotFound");

		return {
			...client,
			clientUri: safeExternalUrl(client.clientUri),
		};
	});
