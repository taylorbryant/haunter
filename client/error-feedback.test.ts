import { describe, expect, test } from "bun:test";
import { makeQueryClient } from "@/client";
import {
	authErrorMessage,
	reportUserError,
	subscribeUserErrors,
} from "@/client/error-feedback";

describe("client error feedback", () => {
	test("publishes direct user-facing errors and supports cleanup", () => {
		const received: string[] = [];
		const unsubscribe = subscribeUserErrors((message) =>
			received.push(message),
		);

		reportUserError("The action failed.");
		unsubscribe();
		reportUserError("This should not be received.");

		expect(received).toEqual(["The action failed."]);
	});

	test("reports unhandled mutations through the global fallback", async () => {
		const queryClient = makeQueryClient();
		const received: string[] = [];
		const unsubscribe = subscribeUserErrors((message) =>
			received.push(message),
		);
		const mutation = queryClient.getMutationCache().build(queryClient, {
			mutationFn: async () => {
				throw new Error("network unavailable");
			},
		});

		await mutation.execute(undefined).catch(() => undefined);
		unsubscribe();

		expect(received).toEqual(["Something went wrong. Please try again."]);
	});

	test("does not duplicate errors handled inline", async () => {
		const queryClient = makeQueryClient();
		const received: string[] = [];
		const unsubscribe = subscribeUserErrors((message) =>
			received.push(message),
		);
		const mutation = queryClient.getMutationCache().build(queryClient, {
			meta: { errorMode: "inline" },
			mutationFn: async () => {
				throw new Error("handled by the component");
			},
		});

		await mutation.execute(undefined).catch(() => undefined);
		unsubscribe();

		expect(received).toEqual([]);
	});

	test("reports failed refreshes without discarding cached query data", async () => {
		const queryClient = makeQueryClient();
		const received: string[] = [];
		const unsubscribe = subscribeUserErrors((message) =>
			received.push(message),
		);
		queryClient.setQueryData<{ value: string }>(["cached"], {
			value: "still usable",
		});

		await queryClient
			.fetchQuery({
				queryKey: ["cached"],
				staleTime: 0,
				queryFn: async () => {
					throw new Error("offline");
				},
			})
			.catch(() => undefined);
		unsubscribe();

		expect(queryClient.getQueryData<{ value: string }>(["cached"])).toEqual({
			value: "still usable",
		});
		expect(received).toEqual(["Some information could not be refreshed."]);
	});

	test("does not report query failures handled by the caller", async () => {
		const queryClient = makeQueryClient();
		const received: string[] = [];
		const unsubscribe = subscribeUserErrors((message) =>
			received.push(message),
		);
		queryClient.setQueryData<{ value: string }>(["handled-query"], {
			value: "still usable",
		});

		await queryClient
			.fetchQuery({
				queryKey: ["handled-query"],
				staleTime: 0,
				meta: { errorMode: "silent" },
				queryFn: async () => {
					throw new Error("handled by the caller");
				},
			})
			.catch(() => undefined);
		unsubscribe();

		expect(received).toEqual([]);
	});

	test("preserves Better Auth's structured user-facing message", () => {
		expect(
			authErrorMessage(
				{ message: "That email address is already in use." },
				"Could not update your profile.",
			),
		).toBe("That email address is already in use.");
		expect(authErrorMessage(new Error("network detail"), "Try again.")).toBe(
			"network detail",
		);
		expect(authErrorMessage({}, "Try again.")).toBe("Try again.");
	});
});
