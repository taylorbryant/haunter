import { BootstrapAdminInputSchema } from "@/features/admin/schemas";
import { bootstrapAdminUseCase } from "@/features/admin/use-cases";
import { defineTask } from "@/lib/tasks";

export const bootstrapTask = defineTask("admin.bootstrap", {
	input: BootstrapAdminInputSchema,
	description:
		"Promote one verified account when Haunter has no approved administrator.",
	async handle({ input, ctx }) {
		const result = await bootstrapAdminUseCase.run({ ctx, input });
		if (result.status === "admin-exists") {
			throw new Error(
				"Haunter already has an approved administrator; no account was changed.",
			);
		}
		if (result.status === "user-not-found") {
			throw new Error(
				`No OTP-verified account exists for ${input.email}. Sign in once, then rerun this command.`,
			);
		}

		ctx.ports.logger.info(
			result.status === "already-admin"
				? "Bootstrap administrator already configured"
				: "Bootstrap administrator configured",
			{ userId: result.user.id, email: result.user.email },
		);
		return result;
	},
});
