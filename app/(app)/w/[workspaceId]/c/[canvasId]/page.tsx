import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { makeQueryClient } from "@/client";
import { getCanvasQueryOptions } from "@/features/canvases/client/queries";
import { StandaloneCanvas } from "@/features/canvases/components/standalone-canvas";
import { getCanvasUseCase } from "@/features/canvases/use-cases";
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
			getCanvasQueryOptions(canvasId),
			getCanvasUseCase,
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
