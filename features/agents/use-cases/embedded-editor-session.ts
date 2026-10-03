import { useCase } from "@/lib/use-case";
import { appError } from "@/features/shared/errors";
import {
	EmbeddedEditorExchangeSchema,
	EmbeddedEditorIdentitySchema,
} from "../embedded-editor-session";
import { z } from "zod";
export const exchangeEmbeddedEditorUseCase = useCase
	.command("agents.exchangeEmbeddedEditor")
	.input(EmbeddedEditorExchangeSchema)
	.output(
		z.object({ token: z.string(), identity: EmbeddedEditorIdentitySchema }),
	)
	.run(async ({ ctx, input }) => {
		const result = await ctx.ports.embeddedEditorSessions.exchange(input);
		if (!result) throw appError("Unauthorized");
		return result;
	});
export const verifyEmbeddedEditorUseCase = useCase
	.query("agents.verifyEmbeddedEditor")
	.input(z.object({}))
	.output(EmbeddedEditorIdentitySchema)
	.run(async ({ ctx }) => {
		if (!ctx.embeddedEditor) throw appError("Unauthorized");
		return ctx.embeddedEditor;
	});
