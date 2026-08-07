import { describe, expect, it } from "bun:test";
import { makeQueryClient } from "@/client";

describe("query client freshness", () => {
	it("does not immediately refetch server-hydrated data", () => {
		const queryClient = makeQueryClient();

		expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(60_000);
	});
});
