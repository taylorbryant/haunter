import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { getPageQueryOptions } from "@/features/pages/client/queries";
import { useCachedPage } from "@/features/pages/client/use-cached-page";

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

	expect(queryClient.getQueryCache().find({ queryKey, exact: true })).toBeUndefined();
});
