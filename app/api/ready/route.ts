import { createHealthRoute } from "@beignet/next";
import { env } from "@/lib/env";
import { getServer } from "@/server";

export const { GET } = createHealthRoute(
	getServer,
	{
		checks: {
			database: (ports) => ports.db.checkHealth(),
		},
		timeoutMs: 2000,
	},
	env.NODE_ENV,
);
