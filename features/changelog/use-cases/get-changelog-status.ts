import "@beignet/core/server-only";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { LATEST_CHANGELOG_VERSION } from "../releases";
import { ChangelogStatusSchema } from "../schemas";

export const getChangelogStatusUseCase = useCase
	.query("changelog.getStatus")
	.input(z.object({}))
	.output(ChangelogStatusSchema)
	.run(async ({ ctx }) => {
		const user = requireUser(ctx);
		const lastSeenVersion = await ctx.ports.changelogState.getLastSeenVersion(
			user.id,
		);
		return {
			latestVersion: LATEST_CHANGELOG_VERSION,
			lastSeenVersion,
			hasUnread: lastSeenVersion !== LATEST_CHANGELOG_VERSION,
		};
	});
