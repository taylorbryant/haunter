import "@beignet/core/server-only";
import {
	workspaceChangesBinding,
	workspaceCanvasActivityBinding,
	workspaceFavoritesBinding,
} from "@/features/collab/broadcasts";
import { defineChannelRegistry } from "@/lib/broadcasting";
import { embeddedAppearanceBinding } from "@/features/agents/broadcasts";

export const channels = defineChannelRegistry([
	embeddedAppearanceBinding,
	workspaceChangesBinding,
	workspaceCanvasActivityBinding,
	workspaceFavoritesBinding,
]);
