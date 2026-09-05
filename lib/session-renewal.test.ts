import { expect, spyOn, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { verifyBrowserSession } from "@/client/session-verification";

test("deferred renewal leaves server reads unchanged and renews the browser cookie through POST", async () => {
	const database: Record<string, Array<Record<string, unknown>>> = {
		user: [],
		session: [],
		account: [],
		verification: [],
	};
	const auth = betterAuth({
		baseURL: "http://localhost:3107",
		secret: "isolated-session-renewal-test-secret-2026",
		database: memoryAdapter(database),
		emailAndPassword: { enabled: true },
		session: {
			deferSessionRefresh: true,
			expiresIn: 300,
			updateAge: 60,
			cookieCache: { enabled: true, maxAge: 1800 },
		},
	});
	const signIn = await auth.handler(
		new Request("http://localhost:3107/api/auth/sign-up/email", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://localhost:3107",
			},
			body: JSON.stringify({
				email: "renewal@example.test",
				name: "Renewal",
				password: "synthetic-test-password-2026",
			}),
		}),
	);
	expect(signIn.status).toBe(200);
	// Simulate nearing the original cookie deadline, after its cache has expired.
	const cookie = signIn.headers
		.getSetCookie()
		.filter((value) => value.startsWith("better-auth.session_token="))
		.map((value) => value.split(";")[0])
		.join("; ");
	expect(cookie.length).toBeGreaterThan(0);
	const oldExpiry = new Date(Date.now() + 5_000);
	const stored = database.session[0];
	if (!stored) throw new Error("Sign-in did not create a session");
	stored.expiresAt = oldExpiry;
	stored.updatedAt = new Date(Date.now() - 295_000);
	const headers = new Headers({
		Cookie: cookie,
		Origin: "http://localhost:3107",
	});
	await auth.api.getSession({ headers });
	expect(new Date(database.session[0]?.expiresAt as string).getTime()).toBe(
		oldExpiry.getTime(),
	);
	const cookies = new Map<string, string>();
	function applyCookies(values: string[]) {
		for (const value of values) {
			const pair = value.split(";")[0];
			if (!pair) continue;
			const separator = pair.indexOf("=");
			cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
		}
	}
	applyCookies([cookie]);
	const requests: string[] = [];
	const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (
				url: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				const method = init?.method ?? "GET";
				requests.push(method);
				// A browser applies the GET's fresh cache cookie before making the POST.
				if (method === "POST")
					expect(cookies.has("better-auth.session_data")).toBe(true);
				const requestHeaders = new Headers(init?.headers);
				requestHeaders.set("Origin", "http://localhost:3107");
				requestHeaders.set(
					"Cookie",
					[...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
				);
				const response = await auth.handler(
					new Request(new URL(String(url), "http://localhost:3107"), {
						...init,
						headers: requestHeaders,
					}),
				);
				expect(response.status).toBe(200);
				applyCookies(response.headers.getSetCookie());
				if (method === "GET") {
					expect(await response.clone().json()).toMatchObject({
						needsRefresh: true,
					});
					expect(
						new Date(database.session[0]?.expiresAt as string).getTime(),
					).toBe(oldExpiry.getTime());
				} else {
					expect(
						response.headers
							.getSetCookie()
							.some(
								(value) =>
									value.startsWith("better-auth.session_token=") &&
									value.includes("Max-Age=300"),
							),
					).toBe(true);
				}
				return response;
			},
			{ preconnect: fetch.preconnect },
		),
	);
	try {
		const userId = stored.userId;
		if (typeof userId !== "string") throw new Error("Session has no user ID");
		expect(
			await verifyBrowserSession({
				userId,
				workspaceId: null,
				requireEdit: false,
				recover: false,
				signal: new AbortController().signal,
			}),
		).toEqual({ userId, workspaceId: null, role: null });
		expect(requests).toEqual(["GET", "POST"]);
		expect(
			new Date(database.session[0]?.expiresAt as string).getTime(),
		).toBeGreaterThan(oldExpiry.getTime() + 200_000);
	} finally {
		fetchSpy.mockRestore();
	}
});
