import "@beignet/core/server-only";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { LATEST_CHANGELOG_VERSION } from "../releases";
import { MarkChangelogSeenOutputSchema } from "../schemas";

export const markChangelogSeenUseCase = useCase
	.command("changelog.markSeen")
	.input(z.object({}))
	.output(MarkChangelogSeenOutputSchema)
	.run(async ({ ctx }) => {
		const user = requireUser(ctx);
		await ctx.ports.changelogState.markSeen(user.id, LATEST_CHANGELOG_VERSION);
		return {
			lastSeenVersion: LATEST_CHANGELOG_VERSION,
			hasUnread: false as const,
		};
	});
