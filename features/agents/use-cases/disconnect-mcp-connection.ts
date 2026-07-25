import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import {
	DisconnectMcpConnectionInputSchema,
	DisconnectMcpConnectionOutputSchema,
} from "@/features/agents/schemas";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

export const disconnectMcpConnectionUseCase = useCase
	.command("agents.disconnectMcpConnection")
	.input(DisconnectMcpConnectionInputSchema)
	.output(DisconnectMcpConnectionOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const disconnected = await ctx.ports.uow.transaction((ports) =>
			ports.mcpConnections.disconnectOwned(
				user.id,
				input.connectionId,
				new Date(),
			),
		);
		if (!disconnected) throw appError("McpConnectionNotFound");
		return { disconnected: true as const };
	});
