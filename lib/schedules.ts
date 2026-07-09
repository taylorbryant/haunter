import { createSchedules } from "@beignet/core/schedules";
import type { AppContext } from "@/app-context";

export const { defineSchedule } = createSchedules<AppContext>();
