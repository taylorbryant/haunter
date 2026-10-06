import "@beignet/core/server-only";
import { z } from "zod";
import { useCase } from "@/lib/use-case";
import { appError } from "@/features/shared/errors";
import { EmbeddedAppearanceSchema } from "../schemas";

export const getEmbeddedAppearanceUseCase = useCase
	.query("agents.getEmbeddedAppearance")
	.input(z.object({}))
	.output(EmbeddedAppearanceSchema)
	.run(async ({ ctx }) => {
		if (ctx.embeddedEditor?.scope !== "workspace") throw appError("Forbidden");
		return ctx.ports.embeddedAppearance.get(ctx.embeddedEditor.user.id);
	});

export const updateEmbeddedAppearanceUseCase = useCase
	.command("agents.updateEmbeddedAppearance")
	.input(EmbeddedAppearanceSchema)
	.output(EmbeddedAppearanceSchema)
	.run(async ({ ctx, input }) => {
		if (ctx.embeddedEditor?.scope !== "workspace") throw appError("Forbidden");
		await ctx.ports.embeddedAppearance.set(ctx.embeddedEditor.user.id, input);
		return input;
	});
