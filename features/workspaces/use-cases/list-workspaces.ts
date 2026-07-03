import "@beignet/core/server-only";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListWorkspacesOutputSchema } from "../schemas";

export const listWorkspacesUseCase = useCase
	.query("workspaces.list")
	.input(z.object({}))
	.output(ListWorkspacesOutputSchema)
	.run(async ({ ctx }) => {
		const user = requireUser(ctx);
		const items = await ctx.ports.workspaces.listByUser(user.id);
		return { items };
	});
