/** At most one automatic checkpoint per page per interval. */
export const PAGE_CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;

/** Versions kept per page; older ones are pruned. */
export const PAGE_VERSION_RETENTION = 50;
