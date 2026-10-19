import { expect, test } from "bun:test";
import { oauthCallback } from "../src/auth";

test("the OAuth callback rejects invalid state and accepts a code only once", async () => {
	const callback = await oauthCallback("expected-state", 0);
	try {
		expect(
			(await fetch(`${callback.url}?code=wrong&state=forged`)).status,
		).toBe(400);
		expect(
			(await fetch(callback.url.replace("/callback", "/other"))).status,
		).toBe(404);
		const response = await fetch(
			`${callback.url}?code=accepted&state=expected-state`,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await callback.code).toBe("accepted");
		expect(
			(await fetch(`${callback.url}?code=replayed&state=expected-state`))
				.status,
		).toBe(400);
	} finally {
		await callback.close();
	}
});

test("denied and cancelled sign-ins reject and release the callback listener", async () => {
	const denied = await oauthCallback("state", 0);
	try {
		await fetch(`${denied.url}?error=access_denied&state=state`);
		await expect(denied.code).rejects.toThrow("not approved");
	} finally {
		await denied.close();
	}
	const controller = new AbortController();
	const cancelled = await oauthCallback("state", 0, controller.signal);
	try {
		controller.abort();
		await expect(cancelled.code).rejects.toThrow("cancelled");
	} finally {
		await cancelled.close();
	}
	const reopened = await oauthCallback(
		"state",
		Number(new URL(cancelled.url).port),
	);
	await reopened.close();
});
