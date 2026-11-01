import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import type { PushSubscriptionStatus } from "../schemas";

let cache: QueryClient;
let notificationDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
	installTestDom();
	notificationDescriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		"Notification",
	);
	cache = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
});

afterEach(async () => {
	cleanup();
	cache.clear();
	mock.restore();
	if (notificationDescriptor)
		Object.defineProperty(globalThis, "Notification", notificationDescriptor);
	else Reflect.deleteProperty(globalThis, "Notification");
	await uninstallTestDom();
});

async function fixture(
	status: PushSubscriptionStatus,
	rejectRegistration = false,
) {
	const calls: string[] = [];
	let removed = false;
	const endpoint = "https://push.example.test/subscription";
	const subscription = {
		endpoint,
		toJSON: () => ({
			endpoint,
			keys: { p256dh: "public-key", auth: "auth-key" },
		}),
		unsubscribe: async () => {
			removed = true;
			return true;
		},
	};
	Object.defineProperty(navigator, "serviceWorker", {
		configurable: true,
		value: {
			ready: Promise.resolve({
				pushManager: {
					getSubscription: async () => (removed ? null : subscription),
					subscribe: async () => subscription,
				},
			}),
		},
	});
	Object.defineProperty(window, "PushManager", {
		configurable: true,
		value: class {},
	});
	const notification = { requestPermission: async () => "granted" };
	Object.defineProperty(window, "Notification", {
		configurable: true,
		value: notification,
	});
	Object.defineProperty(globalThis, "Notification", {
		configurable: true,
		value: notification,
	});
	spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(String(input), "http://localhost:3000");
				calls.push(url.pathname);
				if (url.pathname === "/api/notification-settings")
					return Response.json({
						overdueTasksEnabled: true,
						taskAssignmentsEnabled: true,
						taskRemindersEnabled: true,
						timezone: "UTC",
						timezoneConfigured: true,
						pushSupported: true,
						vapidPublicKey: "dGVzdA",
					});
				if (url.pathname === "/api/push-subscriptions/status") {
					expect(init?.method).toBe("POST");
					expect(JSON.parse(String(init?.body))).toEqual({ endpoint });
					return Response.json({ status });
				}
				if (url.pathname === "/api/push-subscriptions/unsubscribe")
					return Response.json({ subscribed: false });
				if (url.pathname === "/api/push-subscriptions" && rejectRegistration)
					return Response.json(
						{
							code: "UNSUPPORTED_PUSH_SERVICE",
							message: "This browser's push service is not supported.",
						},
						{ status: 422 },
					);
				throw new Error(`Unexpected request: ${url.pathname}`);
			},
			{ preconnect: fetch.preconnect },
		),
	);
	const { NotificationSettingsPanel } = await import(
		"../components/notification-settings-panel"
	);
	const view = render(
		<QueryClientProvider client={cache}>
			<NotificationSettingsPanel />
		</QueryClientProvider>,
	);
	return { view, calls, wasRemoved: () => removed };
}

test.each(["unsupported-service", "invalid-subscription"] as const)(
	"saved %s devices are not shown enabled and can be removed",
	async (status) => {
		const { view, calls, wasRemoved } = await fixture(status);
		const user = userEvent.setup({ document });
		const remove = await view.findByRole("button", {
			name: "Remove device subscription",
		});
		const toggle = view.getByRole("switch", { name: "Push on this device" });
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		expect(toggle.hasAttribute("disabled")).toBe(true);
		expect(
			view.queryByRole("button", { name: "Send test notification" }),
		).toBeNull();
		expect(
			view.getByText(
				status === "unsupported-service"
					? /Try another browser/
					: /Remove it and enable push again/,
			),
		).toBeTruthy();
		await user.click(remove);
		await waitFor(() => expect(wasRemoved()).toBe(true));
		await waitFor(() =>
			expect(
				view.queryByRole("button", { name: "Remove device subscription" }),
			).toBeNull(),
		);
		expect(calls).toContain("/api/push-subscriptions/unsubscribe");
	},
);

test("a saved browser subscription is enabled only after the server confirms its status", async () => {
	const { view, calls } = await fixture("enabled");
	await view.findByRole("button", { name: "Send test notification" });
	expect(
		view
			.getByRole("switch", { name: "Push on this device" })
			.getAttribute("aria-checked"),
	).toBe("true");
	expect(calls).toContain("/api/push-subscriptions/status");
});

test("a registration rejection leaves push disabled with an actionable explanation", async () => {
	const { view } = await fixture("disabled", true);
	const user = userEvent.setup({ document });
	const toggle = await view.findByRole("switch", {
		name: "Push on this device",
	});
	await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
	await user.click(toggle);
	await view.findByRole("button", { name: "Remove device subscription" });
	expect(toggle.getAttribute("aria-checked")).toBe("false");
	expect(view.getByText(/Try another browser/)).toBeTruthy();
	expect(
		view.queryByText("Push notifications enabled on this device."),
	).toBeNull();
});
