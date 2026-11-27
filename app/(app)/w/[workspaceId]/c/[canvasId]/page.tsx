import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { makeQueryClient } from "@/client";
import { getCanvasMetadataQueryOptions } from "@/features/canvases/client/queries";
import { StandaloneCanvas } from "@/features/canvases/components/standalone-canvas";
import { getCanvasMetadataUseCase } from "@/features/canvases/use-cases";
import {
	getAppRequestContext,
	serverUseCaseQueryOptions,
} from "@/lib/server-react-query";

export default async function StandaloneCanvasPage({
	params,
}: {
	params: Promise<{ canvasId: string; workspaceId: string }>;
}) {
	const [{ canvasId }, ctx] = await Promise.all([
		params,
		getAppRequestContext(),
	]);
	const queryClient = makeQueryClient();

	await queryClient.prefetchQuery(
		serverUseCaseQueryOptions(
			getCanvasMetadataQueryOptions(canvasId),
			getCanvasMetadataUseCase,
			ctx,
			{ id: canvasId },
		),
	);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<StandaloneCanvas canvasId={canvasId} />
		</HydrationBoundary>
	);
}
