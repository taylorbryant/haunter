import { z } from "zod";

export const WaitlistEmailSchema = z.preprocess(
	(value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
	z.string().max(320).email(),
);

export const RequestAccessInputSchema = z.object({
	email: WaitlistEmailSchema,
});

export const RequestAccessStatusSchema = z.enum(["existing", "waitlisted"]);

export const RequestAccessOutputSchema = z.object({
	status: RequestAccessStatusSchema,
});

export type RequestAccessInput = z.infer<typeof RequestAccessInputSchema>;
export type RequestAccessOutput = z.infer<typeof RequestAccessOutputSchema>;

