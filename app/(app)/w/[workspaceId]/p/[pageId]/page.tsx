import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { makeQueryClient } from "@/client";
import { getPageQueryOptions } from "@/features/pages/client/queries";
import { PageEditor } from "@/features/pages/components/page-editor";
import { getPageUseCase } from "@/features/pages/use-cases";
import {
	getAppRequestContext,
	serverUseCaseQueryOptions,
} from "@/lib/server-react-query";

export default async function PagePage({
	params,
}: {
	params: Promise<{ pageId: string; workspaceId: string }>;
}) {
	const [{ pageId, workspaceId }, ctx] = await Promise.all([
		params,
		getAppRequestContext(),
	]);
	const queryClient = makeQueryClient();
	const activeWorkspaceId = ctx.auth?.session?.activeOrganizationId ?? null;

	if (activeWorkspaceId === workspaceId) {
		await queryClient.prefetchQuery(
			serverUseCaseQueryOptions(
				getPageQueryOptions(pageId),
				getPageUseCase,
				ctx,
				{ id: pageId },
			),
		);
	}

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<PageEditor pageId={pageId} />
		</HydrationBoundary>
	);
}
