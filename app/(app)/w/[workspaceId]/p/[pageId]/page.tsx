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
	searchParams,
}: {
	params: Promise<{ pageId: string; workspaceId: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const routeStartedAt = performance.now();
	const contextStartedAt = performance.now();
	const contextPromise = getAppRequestContext().then((ctx) => ({
		ctx,
		durationMs: performance.now() - contextStartedAt,
	}));
	const [{ pageId, workspaceId }, { ctx, durationMs: contextMs }, search] =
		await Promise.all([params, contextPromise, searchParams]);
	const timingEnabled =
		search.perf === "1" || process.env.HAUNTER_PERFORMANCE_LOGGING === "1";
	const queryClient = makeQueryClient();
	const activeWorkspaceId = ctx.auth?.session?.activeOrganizationId ?? null;
	let pageQueryMs: number | null = null;

	if (activeWorkspaceId === workspaceId) {
		try {
			const pageQueryStartedAt = performance.now();
			const page = await queryClient.fetchQuery(
				serverUseCaseQueryOptions(
					getPageQueryOptions(pageId),
					getPageUseCase,
					ctx,
					{ id: pageId },
				),
			);
			pageQueryMs = performance.now() - pageQueryStartedAt;
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

	if (timingEnabled) {
		console.info("[page-load:server]", {
			pageId,
			contextMs: Math.round(contextMs),
			pageQueryMs: pageQueryMs === null ? null : Math.round(pageQueryMs),
			routeMs: Math.round(performance.now() - routeStartedAt),
		});
	}

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<PageEditor pageId={pageId} />
		</HydrationBoundary>
	);
}
