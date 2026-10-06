import "@beignet/core/server-only";
import {
	workspaceChangesBinding,
	workspaceCanvasActivityBinding,
	workspaceFavoritesBinding,
} from "@/features/collab/broadcasts";
import { defineChannelRegistry } from "@/lib/broadcasting";

export const channels = defineChannelRegistry([
	workspaceChangesBinding,
	workspaceCanvasActivityBinding,
	workspaceFavoritesBinding,
]);
