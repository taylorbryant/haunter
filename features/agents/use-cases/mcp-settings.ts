import "@beignet/core/server-only";
import { z } from "zod";
import type { AppContext } from "@/app-context";
import { appError } from "@/features/shared/errors";
import { useCase } from "@/lib/use-case";
import { EmbeddedAppearanceSchema } from "../schemas";
import { saveEmbeddedAppearance } from "../server/embedded-appearance";

// Identity is supplied only by the authenticated MCP transport, never tool arguments.
const IdentitySchema = z.object({
	userId: z.string().min(1),
	clientId: z.string().min(1),
});
async function authorize(
	ctx: AppContext,
	identity: z.infer<typeof IdentitySchema>,
) {
	if (
		!(await ctx.ports.mcpConnections.findActive(
			identity.userId,
			identity.clientId,
		))
	)
		throw appError("Forbidden");
}

export const readMcpSettingsUseCase = useCase
	.query("agents.readMcpSettings")
	.input(IdentitySchema)
	.output(EmbeddedAppearanceSchema)
	.run(async ({ ctx, input }) => {
		await authorize(ctx, input);
		return ctx.ports.embeddedAppearance.get(input.userId);
	});

export const updateMcpSettingsUseCase = useCase
	.command("agents.updateMcpSettings")
	.input(IdentitySchema.extend({ appearance: EmbeddedAppearanceSchema }))
	.output(EmbeddedAppearanceSchema)
	.run(async ({ ctx, input }) => {
		await authorize(ctx, input);
		return saveEmbeddedAppearance(ctx, input.userId, input.appearance);
	});
