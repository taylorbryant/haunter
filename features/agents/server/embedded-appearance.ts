import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import { embeddedAppearanceChanges } from "../channels";
import type { EmbeddedAppearance } from "../schemas";

export async function saveEmbeddedAppearance(
	ctx: AppContext,
	userId: string,
	appearance: EmbeddedAppearance,
) {
	await ctx.ports.embeddedAppearance.set(userId, appearance);
	ctx.ports.bestEffortWork.defer(async () => {
		try {
			await ctx.ports.broadcast.publish(embeddedAppearanceChanges, {
				params: { userId },
				event: "changed",
				data: {},
			});
		} catch (error) {
			ctx.ports.logger.warn(
				"Failed to broadcast an embedded appearance change",
				{ error },
			);
		}
	});
	return appearance;
}
