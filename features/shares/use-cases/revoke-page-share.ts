import "@beignet/core/server-only";
import { z } from "zod";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageIdInputSchema } from "../schemas";

export const revokePageShareUseCase = useCase
	.command("shares.revoke")
	.input(PageIdInputSchema)
	.output(z.void())
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		await ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(input.pageId);
			if (!page) {
				throw appError("PageNotFound", { details: { id: input.pageId } });
			}

			await ctx.gate.authorize("pages.update", page);

			await tx.shares.deleteByPage(input.pageId);
		});
	});
