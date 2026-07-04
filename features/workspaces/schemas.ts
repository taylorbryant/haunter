import { z } from "zod";

export const OnboardInputSchema = z.object({});

export const OnboardOutputSchema = z.object({
	// The active workspace (Better Auth organization) id.
	workspaceId: z.string(),
	// The welcome page to land on, or null when the user was already onboarded.
	pageId: z.string().uuid().nullable(),
});

export type OnboardOutput = z.infer<typeof OnboardOutputSchema>;
