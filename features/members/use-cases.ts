import "@beignet/core/server-only";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	ListWorkspaceMembersInputSchema,
	ListWorkspaceMembersOutputSchema,
} from "./schemas";

export const listWorkspaceMembersUseCase = useCase
	.query("members.listWorkspace")
	.input(ListWorkspaceMembersInputSchema)
	.output(ListWorkspaceMembersOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);
		return { items: await ctx.ports.members.listByWorkspace(scope) };
	});
