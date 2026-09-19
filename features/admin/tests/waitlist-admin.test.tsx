import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { rq } from "@/client";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { listWaitlist } from "../contracts";
import type { WaitlistUser } from "../schemas";

const invitee: WaitlistUser = {
	id: "user_1",
	name: "Invitee",
	email: "invitee@example.test",
	createdAt: "2026-09-18T00:00:00.000Z",
};

let WaitlistAdmin: typeof import("../components/waitlist-admin").WaitlistAdmin;
let queryClient: QueryClient;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeAll(async () => {
	installTestDom();
	WaitlistAdmin = (await import("../components/waitlist-admin")).WaitlistAdmin;
});
afterEach(() => {
	cleanup();
	queryClient.clear();
	fetchSpy.mockRestore();
});
afterAll(uninstallTestDom);

function setup() {
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	queryClient.setQueryData(rq(listWaitlist).key(), { items: [invitee] });
	const requests: Array<{
		method: string;
		url: string;
		response: ReturnType<typeof Promise.withResolvers<Response>>;
	}> = [];
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const response = Promise.withResolvers<Response>();
				requests.push({
					method: init?.method ?? "GET",
					url: String(input),
					response,
				});
				return response.promise;
			},
			{ preconnect: fetch.preconnect },
		),
	);
	const view = render(
		<QueryClientProvider client={queryClient}>
			<WaitlistAdmin />
		</QueryClientProvider>,
	);
	return { view, requests, user: userEvent.setup({ document }) };
}

test("keeps approval pending until the refreshed waitlist removes the user", async () => {
	const { view, requests, user } = setup();
	await user.click(view.getByRole("button", { name: "Approve" }));
	await waitFor(() => expect(requests).toHaveLength(1));
	expect(requests[0].method).toBe("POST");
	expect(requests[0].url).toEndWith(
		`/api/admin/waitlist/${invitee.id}/approve`,
	);
	await act(async () => {
		requests[0].response.resolve(Response.json({ user: invitee }));
	});
	await waitFor(() => expect(requests).toHaveLength(2));
	expect(requests[1].method).toBe("GET");
	expect(requests[1].url).toEndWith("/api/admin/waitlist");
	const pending = view.getByRole("button", { name: "Approving…" });
	expect(pending.hasAttribute("disabled")).toBe(true);
	await user.click(pending);
	expect(requests).toHaveLength(2);
	await act(async () => {
		requests[1].response.resolve(Response.json({ items: [] }));
	});
	expect(
		await view.findByText("No one is waiting for access right now."),
	).not.toBeNull();
	expect(view.queryByText(invitee.name)).toBeNull();
});

test("failed approval keeps the user visible and allows retry without refreshing", async () => {
	const { view, requests, user } = setup();
	await user.click(view.getByRole("button", { name: "Approve" }));
	await waitFor(() => expect(requests).toHaveLength(1));
	await act(async () => {
		requests[0].response.resolve(
			Response.json({ message: "Unavailable" }, { status: 500 }),
		);
	});
	expect((await view.findByRole("alert")).textContent).toBe(
		`Could not approve ${invitee.email}. Please try again.`,
	);
	expect(view.getByText(invitee.name)).not.toBeNull();
	const approve = view.getByRole("button", { name: "Approve" });
	expect(approve.hasAttribute("disabled")).toBe(false);
	expect(requests).toHaveLength(1);
	expect(queryClient.getQueryState(rq(listWaitlist).key())?.isInvalidated).toBe(
		false,
	);
	await user.click(approve);
	await waitFor(() => expect(requests).toHaveLength(2));
	expect(view.queryByRole("alert")).toBeNull();
	await act(async () => {
		requests[1].response.resolve(Response.json({ user: invitee }));
	});
	await waitFor(() => expect(requests).toHaveLength(3));
	await act(async () => {
		requests[2].response.resolve(Response.json({ items: [] }));
	});
	expect(
		await view.findByText("No one is waiting for access right now."),
	).not.toBeNull();
});
