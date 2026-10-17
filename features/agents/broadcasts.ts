import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { defineChannelBinding } from "@/lib/broadcasting";
import { embeddedAppearanceChanges } from "./channels";

export const embeddedAppearanceBinding = defineChannelBinding(
	embeddedAppearanceChanges,
	{
		authorize({ ctx, params }) {
			if (
				ctx.embeddedEditor?.scope !== "workspace" ||
				params.userId !== requireUser(ctx).id
			) {
				throw appError("Forbidden");
			}
		},
	},
);
