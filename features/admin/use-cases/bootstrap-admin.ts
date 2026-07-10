import "@beignet/core/server-only";
import {
	BootstrapAdminInputSchema,
	BootstrapAdminResultSchema,
} from "@/features/admin/schemas";
import { useCase } from "@/lib/use-case";

/**
 * One-time operator workflow. This deliberately has no HTTP contract: only the
 * registered operational task can invoke it without an existing admin session.
 */
export const bootstrapAdminUseCase = useCase
	.command("admin.bootstrap")
	.input(BootstrapAdminInputSchema)
	.output(BootstrapAdminResultSchema)
	.run(async ({ ctx, input }) =>
		ctx.ports.uow.transaction((tx) => tx.adminUsers.bootstrap(input.email)),
	);
