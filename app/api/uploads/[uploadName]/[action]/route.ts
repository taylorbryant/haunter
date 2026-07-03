import {
	createUploadRouter,
	defineUploads,
	uploadsFromRegistry,
} from "@beignet/core/uploads";
import { createUploadRoute } from "@beignet/next";
import { pageUploads } from "@/features/pages/uploads";
import { getServer } from "@/server";

const uploadRegistry = defineUploads({
	page: pageUploads,
});

// createUploadRoute accepts a loader for its router, so the server boots on
// the first request rather than at module import (Next build) time.
export const { POST } = createUploadRoute(async () => {
	const server = await getServer();
	return createUploadRouter({
		uploads: uploadsFromRegistry(uploadRegistry),
		ctx: () => server.createContextFromNext(),
		storage: server.ports.storage,
	});
});
