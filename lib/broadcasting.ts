import "@beignet/core/server-only";
import { createBroadcasting } from "@beignet/core/broadcasting/server";
import type { AppContext } from "@/app-context";

export const { defineChannelBinding, defineChannelRegistry } =
	createBroadcasting<AppContext>();
