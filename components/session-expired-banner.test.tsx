import { afterEach, beforeEach, expect, test } from "bun:test";
import { ContractError } from "@beignet/core/client";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	clearSessionExpired,
	registerSessionRecoveryPreparer,
	reportSessionExpired,
} from "@/client/session-expiration";
import { SessionExpiredBanner } from "@/components/session-expired-banner";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(() => {
	installTestDom();
	clearSessionExpired();
});
afterEach(() => {
	cleanup();
	clearSessionExpired();
	uninstallTestDom();
});

function unauthorizedError() {
	return new ContractError({
		source: "http",
		status: 401,
		code: "UNAUTHORIZED",
		message: "Authentication required",
	});
}

test("replaces concurrent unauthorized errors with one recovery notice", () => {
	const view = render(<SessionExpiredBanner />);

	act(() => {
		reportSessionExpired(unauthorizedError());
		reportSessionExpired(unauthorizedError());
	});

	expect(view.getAllByText("Session expired")).toHaveLength(1);
	expect(view.getByRole("status")).not.toBeNull();
	expect(view.getByRole("button", { name: "Sign in again" })).not.toBeNull();
	expect(view.queryByText("Unauthorized")).toBeNull();
});

test("shows an expiration reported before the banner subscribes", () => {
	reportSessionExpired(unauthorizedError());

	const view = render(<SessionExpiredBanner />);

	expect(view.getByText("Session expired")).not.toBeNull();
	expect(view.getByRole("button", { name: "Sign in again" })).not.toBeNull();
});

test("keeps the current page open when its recovery copy cannot be stored", async () => {
	const user = userEvent.setup({ document });
	const unregister = registerSessionRecoveryPreparer(async () => {
		throw new Error("IndexedDB unavailable");
	});
	const view = render(<SessionExpiredBanner />);
	act(() => {
		reportSessionExpired(unauthorizedError());
	});

	await user.click(view.getByRole("button", { name: "Sign in again" }));
	unregister();

	expect(window.location.pathname).toBe("/");
	expect(view.getByText(/could not store a recovery copy/i)).not.toBeNull();
});
