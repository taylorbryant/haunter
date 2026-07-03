import {
	createUploadRouter,
	defineUploads,
	uploadsFromRegistry,
} from "@beignet/core/uploads";
import { createUploadRoute } from "@beignet/next";
import { pageUploads } from "@/features/pages/uploads";
import { server } from "@/server";

const uploadRegistry = defineUploads({
	page: pageUploads,
});

const uploadRouter = createUploadRouter({
	uploads: uploadsFromRegistry(uploadRegistry),
	ctx: () => server.createContextFromNext(),
	storage: server.ports.storage,
});

export const { POST } = createUploadRoute(uploadRouter);
