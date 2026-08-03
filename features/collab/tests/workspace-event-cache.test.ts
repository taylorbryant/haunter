import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	getPageQueryOptions,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import {
	invalidateWorkspacePageProjections,
	pageIsMissingFromWorkspaceProjection,
} from "../client/workspace-event-cache";

describe("workspace event cache reconciliation", () => {
	it("waits for optimistic client mutations before invalidating projections", async () => {
		const queryClient = new QueryClient();
		let finishMutation: (() => void) | undefined;
		const mutation = queryClient.getMutationCache().build(queryClient, {
			mutationFn: () =>
				new Promise<void>((resolve) => {
					finishMutation = resolve;
				}),
		});
		const mutationPromise = mutation.execute(undefined);
		await Promise.resolve();

		let invalidated = false;
		const invalidation = invalidateWorkspacePageProjections(
			queryClient,
			"workspace_1",
			["page_1"],
		).then(() => {
			invalidated = true;
		});
		await Promise.resolve();
		expect(invalidated).toBe(false);

		finishMutation?.();
		await mutationPromise;
		await invalidation;
		expect(invalidated).toBe(true);
	});

	it("invalidates every page affected by a subtree mutation", async () => {
		const queryClient = new QueryClient();
		const rootQuery = getPageQueryOptions("root");
		const childQuery = getPageQueryOptions("child");
		queryClient.setQueryData(rootQuery.queryKey, { id: "root" });
		queryClient.setQueryData(childQuery.queryKey, { id: "child" });

		await invalidateWorkspacePageProjections(queryClient, "workspace_1", [
			"root",
			"child",
		]);

		expect(queryClient.getQueryState(rootQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
		expect(queryClient.getQueryState(childQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
	});

	it("detects an open page removed while workspace broadcasts were missed", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(listPagesQueryOptions("workspace_1").queryKey, {
			items: [{ id: "remaining" }],
		});

		expect(
			pageIsMissingFromWorkspaceProjection(
				queryClient,
				"workspace_1",
				"deleted",
			),
		).toBe(true);
		expect(
			pageIsMissingFromWorkspaceProjection(
				queryClient,
				"workspace_1",
				"remaining",
			),
		).toBe(false);
		expect(
			pageIsMissingFromWorkspaceProjection(
				new QueryClient(),
				"workspace_1",
				"deleted",
			),
		).toBe(false);
	});
});
