import "@beignet/core/server-only";
import { workspaceChangesBinding } from "@/features/collab/broadcasts";
import { defineChannelRegistry } from "@/lib/broadcasting";

export const channels = defineChannelRegistry([workspaceChangesBinding]);
