import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { makeQueryClient } from "@/client";
import { listCanvasesQueryOptions } from "@/features/canvases/client/queries";
import { CanvasList } from "@/features/canvases/components/canvas-list";
import { listCanvasesUseCase } from "@/features/canvases/use-cases";
import {
	getAppRequestContext,
	serverUseCaseQueryOptions,
} from "@/lib/server-react-query";

export default async function CanvasesPage({
	params,
}: {
	params: Promise<{ workspaceId: string }>;
}) {
	const [{ workspaceId }, ctx] = await Promise.all([
		params,
		getAppRequestContext(),
	]);
	const queryClient = makeQueryClient();

	await queryClient.prefetchQuery(
		serverUseCaseQueryOptions(
			listCanvasesQueryOptions(workspaceId),
			listCanvasesUseCase,
			ctx,
			{ workspaceId },
		),
	);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
				<CanvasList workspaceId={workspaceId} />
			</div>
		</HydrationBoundary>
	);
}
