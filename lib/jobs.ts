import { createJobs } from "@beignet/core/jobs";
import type { AppContext } from "@/app-context";

export const { defineJob } = createJobs<AppContext>();
