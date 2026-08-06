"use client";

import { useQuery } from "@tanstack/react-query";
import { getPageQueryOptions } from "./queries";

/** Observe the page-query cache without issuing a request. */
export function useCachedPage(pageId: string | null) {
	const query = useQuery({
		...getPageQueryOptions(pageId ?? ""),
		enabled: false,
		notifyOnChangeProps: ["data"],
	});

	return pageId ? query.data : undefined;
}
