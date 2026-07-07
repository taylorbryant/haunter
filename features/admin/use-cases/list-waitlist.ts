import "@beignet/core/server-only";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListWaitlistOutputSchema } from "../schemas";

export const listWaitlistUseCase = useCase
	.query("admin.listWaitlist")
	.input(z.object({}))
	.output(ListWaitlistOutputSchema)
	.run(async ({ ctx }) => {
		requireAdmin(ctx);
		const items = await ctx.ports.adminUsers.listWaitlisted();
		return { items };
	});
