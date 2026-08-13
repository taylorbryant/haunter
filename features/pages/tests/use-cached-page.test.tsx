import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
	dehydrate,
	HydrationBoundary,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { getPageQueryOptions } from "@/features/pages/client/queries";
import { useCachedPage } from "@/features/pages/client/use-cached-page";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(installTestDom);
afterEach(() => {
	cleanup();
	uninstallTestDom();
});

function CachedPageProbe({ pageId }: { pageId: string }) {
	useCachedPage(pageId);
	return null;
}

test("observing a cached page does not create an empty query before hydration", () => {
	const queryClient = new QueryClient();
	const queryKey = getPageQueryOptions("page-1").queryKey;

	renderToString(
		<QueryClientProvider client={queryClient}>
			<CachedPageProbe pageId="page-1" />
		</QueryClientProvider>,
	);

	expect(
		queryClient.getQueryCache().find({ queryKey, exact: true }),
	).toBeUndefined();
});

test("hydration does not update the cached-page observer during another render", () => {
	const queryClient = new QueryClient();
	const serverQueryClient = new QueryClient();
	serverQueryClient.setQueryData(getPageQueryOptions("page-1").queryKey, {
		id: "page-1",
	});
	const dehydratedState = dehydrate(serverQueryClient);
	const view = render(
		<QueryClientProvider client={queryClient}>
			<CachedPageProbe pageId="page-1" />
		</QueryClientProvider>,
	);
	const error = spyOn(console, "error").mockImplementation(() => {});

	try {
		view.rerender(
			<QueryClientProvider client={queryClient}>
				<CachedPageProbe pageId="page-1" />
				<HydrationBoundary state={dehydratedState}>
					<div />
				</HydrationBoundary>
			</QueryClientProvider>,
		);

		expect(
			error.mock.calls.some((call) =>
				String(call[0]).includes("Cannot update a component"),
			),
		).toBe(false);
	} finally {
		error.mockRestore();
	}
});
