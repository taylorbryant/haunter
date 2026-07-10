import { z } from "zod";

/** A user awaiting approval, as shown in the admin waitlist. */
export const WaitlistUserSchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string(),
	createdAt: z.string(),
});

export type WaitlistUser = z.infer<typeof WaitlistUserSchema>;

export const ListWaitlistOutputSchema = z.object({
	items: z.array(WaitlistUserSchema),
});

export type ListWaitlistOutput = z.infer<typeof ListWaitlistOutputSchema>;

export const ApproveWaitlistUserInputSchema = z.object({
	userId: z.string().min(1),
});

export type ApproveWaitlistUserInput = z.infer<
	typeof ApproveWaitlistUserInputSchema
>;

export const ApproveWaitlistUserOutputSchema = z.object({
	user: WaitlistUserSchema,
});

export type ApproveWaitlistUserOutput = z.infer<
	typeof ApproveWaitlistUserOutputSchema
>;

export const BootstrapAdminInputSchema = z.object({
	email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type BootstrapAdminInput = z.infer<typeof BootstrapAdminInputSchema>;

export const BootstrapAdminUserSchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string(),
});

export type BootstrapAdminUser = z.infer<typeof BootstrapAdminUserSchema>;

export const BootstrapAdminResultSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("bootstrapped"),
		user: BootstrapAdminUserSchema,
	}),
	z.object({
		status: z.literal("already-admin"),
		user: BootstrapAdminUserSchema,
	}),
	z.object({ status: z.literal("admin-exists") }),
	z.object({ status: z.literal("user-not-found") }),
]);

export type BootstrapAdminResult = z.infer<typeof BootstrapAdminResultSchema>;
