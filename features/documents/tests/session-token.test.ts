import { describe, expect, test } from "bun:test";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";

describe("document session tokens", () => {
	const tokens = createDocumentSessionTokens(
		"prototype-test-secret-with-at-least-32-characters",
	);
	const input = {
		generation: 0,
		userId: "user",
		workspaceId: "workspace",
		sessionId: "session",
		pageId: crypto.randomUUID(),
	};
	test("binds a short-lived grant to the session, user, workspace and page", () => {
		const grant = tokens.verify(tokens.issue(input).token);
		expect(grant).toMatchObject(input);
		expect(grant.expiresAt - Date.now()).toBeLessThanOrEqual(300_000);
	});
	test("rejects tampering and cross-secret tokens", () => {
		const { token } = tokens.issue(input);
		expect(() => tokens.verify(`x${token}`)).toThrow();
		expect(() => tokens.verify(`${token}.extra`)).toThrow();
		expect(() =>
			createDocumentSessionTokens(
				"a-different-secret-with-at-least-32-characters",
			).verify(token),
		).toThrow();
	});
});
