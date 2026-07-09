import { isAppError } from "@beignet/core/errors";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { notFound } from "next/navigation";
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
		try {
			const page = await queryClient.fetchQuery(
				serverUseCaseQueryOptions(
					getPageQueryOptions(pageId),
					getPageUseCase,
					ctx,
					{ id: pageId },
				),
			);
			if (page.workspaceId !== workspaceId) {
				notFound();
			}
		} catch (error) {
			if (isAppError(error) && error.code === "PAGE_NOT_FOUND") {
				notFound();
			}
			throw error;
		}
	}

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<PageEditor pageId={pageId} />
		</HydrationBoundary>
	);
}
