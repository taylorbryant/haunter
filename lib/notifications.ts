import { createNotifications } from "@beignet/core/notifications";
import type { AppContext } from "@/app-context";

export const { defineNotification } = createNotifications<AppContext>();
