import "@beignet/core/server-only";
import { useCase } from "@/lib/use-case";
import {
	RequestAccessInputSchema,
	RequestAccessOutputSchema,
} from "../schemas";

export const requestAccessUseCase = useCase
	.command("waitlist.requestAccess")
	.input(RequestAccessInputSchema)
	.output(RequestAccessOutputSchema)
	.run(async ({ ctx, input }) => {
		if (await ctx.ports.waitlist.hasAccount(input.email)) {
			return { status: "existing" };
		}

		await ctx.ports.waitlist.join({ email: input.email });
		return { status: "waitlisted" };
	});

