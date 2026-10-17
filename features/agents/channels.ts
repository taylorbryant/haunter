import { defineChannel } from "@beignet/core/broadcasting";
import { z } from "zod";

/** Personal preference hints, shared across the user's embedded workspaces. */
export const embeddedAppearanceChanges = defineChannel(
	"user.embedded-appearance.v1",
	{
		params: z.object({ userId: z.string().min(1) }),
		events: { changed: z.object({}) },
	},
);
