import { createApiRoute } from "@beignet/next";
import { getServer } from "@/server";

export const { GET, HEAD, OPTIONS, PATCH, POST, PUT, DELETE } =
	createApiRoute(getServer);
