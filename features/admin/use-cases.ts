import "@beignet/core/server-only";
import { z } from "zod";
import { appError } from "@/features/shared/errors";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { useCase } from "@/lib/use-case";
import { buildApprovalEmail } from "./emails/approval-email";
import {
	ApproveWaitlistUserInputSchema,
	ApproveWaitlistUserOutputSchema,
	BootstrapAdminInputSchema,
	BootstrapAdminResultSchema,
	ListWaitlistOutputSchema,
} from "./schemas";

export const listWaitlistUseCase = useCase
	.query("admin.listWaitlist")
	.input(z.object({}))
	.output(ListWaitlistOutputSchema)
	.run(async ({ ctx }) => {
		requireAdmin(ctx);
		const items = await ctx.ports.adminUsers.listWaitlisted();
		return { items };
	});

export const approveWaitlistUserUseCase = useCase
	.command("admin.approveWaitlistUser")
	.input(ApproveWaitlistUserInputSchema)
	.output(ApproveWaitlistUserOutputSchema)
	.run(async ({ ctx, input }) => {
		requireAdmin(ctx);

		// Idempotent: approve() returns null when the user is already approved or
		// unknown, so a double-click never sends a second email.
		const user = await ctx.ports.adminUsers.approve(input.userId);
		if (!user) {
			throw appError("UserNotFound");
		}

		// The account is approved in the database regardless of delivery, so a
		// mail hiccup must not fail the request (re-approving won't re-send). Log
		// and move on.
		try {
			await ctx.ports.mailer.send({
				to: user.email,
				...buildApprovalEmail({
					name: user.name,
					signInUrl: `${env.APP_URL}/sign-in`,
				}),
			});
		} catch (error) {
			ctx.ports.logger.warn("Failed to send waitlist-approval email", {
				error,
				userId: user.id,
			});
		}

		return { user };
	});

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
