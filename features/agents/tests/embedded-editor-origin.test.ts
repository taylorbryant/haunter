import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import nextConfig from "../../../next.config.js";
import { isEmbeddedEditorOrigin } from "../embedded-editor-origin.js";
import { parseMcpUiDomain } from "../mcp-ui-domain.js";

const desktopOrigin =
	"codex-sandbox://mcp-app-d957817f52436527f84905c788364e0b902d1034af7de3eb.web-sandbox.oaiusercontent.com";
const originalOrigins = process.env.MCP_EMBED_ALLOWED_ORIGINS;
const originalUiDomain = process.env.MCP_UI_DOMAIN;
function readHeaders() {
	if (!nextConfig.headers)
		throw new Error("Missing embed header configuration");
	return nextConfig.headers();
}
beforeEach(() => {
	delete process.env.MCP_UI_DOMAIN;
	delete process.env.MCP_EMBED_ALLOWED_ORIGINS;
});
afterEach(() => {
	if (originalOrigins === undefined)
		delete process.env.MCP_EMBED_ALLOWED_ORIGINS;
	else process.env.MCP_EMBED_ALLOWED_ORIGINS = originalOrigins;
	if (originalUiDomain === undefined) delete process.env.MCP_UI_DOMAIN;
	else process.env.MCP_UI_DOMAIN = originalUiDomain;
});

describe("dedicated MCP UI domains", () => {
	test("adds exactly the dedicated sandbox without changing the editor frame domain", async () => {
		const domain = "https://mcp-ui.haunter.app";
		const sandbox = "https://mcp-ui-haunter-app.web-sandbox.oaiusercontent.com";
		expect(parseMcpUiDomain(domain)).toEqual({
			domain,
			sandboxOrigin: sandbox,
		});
		const before = await readHeaders();
		process.env.MCP_UI_DOMAIN = domain;
		const after = await readHeaders();
		expect(after[0]?.source).toBe("/embed/:path*");
		expect(after[0]?.headers[0]?.value).toBe(
			`${before[0]?.headers[0]?.value} ${sandbox}`,
		);
		expect(after[0]?.headers[0]?.value).not.toContain("*");
		expect(after[0]?.headers[0]?.value).not.toContain(domain);
		expect(isEmbeddedEditorOrigin(sandbox)).toBe(true);
		process.env.MCP_EMBED_ALLOWED_ORIGINS = `${desktopOrigin},${sandbox}`;
		const combined = (await readHeaders())[0]?.headers[0]?.value ?? "";
		expect(combined.split(sandbox)).toHaveLength(2);
		expect(combined).toContain(desktopOrigin);
	});

	test("keeps test and production sandbox identities separate", () => {
		expect(
			parseMcpUiDomain("https://mcp-ui-test.haunter.app").sandboxOrigin,
		).toBe("https://mcp-ui-test-haunter-app.web-sandbox.oaiusercontent.com");
	});

	test.each([
		"",
		"mcp-ui.haunter.app",
		"http://mcp-ui.haunter.app",
		"https://localhost",
		"https://127.0.0.1",
		"https://[::1]",
		"https://*.haunter.app",
		"https://user@mcp-ui.haunter.app",
		"https://mcp-ui.haunter.app:443",
		"https://mcp-ui.haunter.app:8443",
		"https://mcp-ui.haunter.app/",
		"https://mcp-ui.haunter.app/path",
		"https://mcp-ui.haunter.app?query",
		"https://mcp-ui.haunter.app#hash",
		"https://mcp-ui.haunter.app\n",
		"https://MCP-UI.haunter.app",
		"https://mcp_ui.haunter.app",
		"https://mcp-ui..haunter.app",
		"https://-mcp.haunter.app",
		`https://${"a".repeat(60)}.app`,
		desktopOrigin,
	])("rejects invalid dedicated identity %s at build time", async (domain) => {
		expect(() => parseMcpUiDomain(domain)).toThrow("MCP_UI_DOMAIN");
		process.env.MCP_UI_DOMAIN = domain;
		await expect(readHeaders()).rejects.toThrow("MCP_UI_DOMAIN");
	});
});

describe("embedded editor parent origins", () => {
	test.each([
		"https://chatgpt.com",
		"https://web-sandbox.oaiusercontent.com",
		"http://127.0.0.1:8797",
		"http://localhost:3000",
		desktopOrigin,
	])("accepts exact host origin %s", (origin) => {
		expect(isEmbeddedEditorOrigin(origin)).toBe(true);
	});

	test.each([
		null,
		"null",
		"*",
		"https:",
		"https://*.oaiusercontent.com",
		"https://chatgpt.com/",
		"https://user@chatgpt.com",
		"https://chatgpt.com:443",
		"https://chatgpt.com/path",
		"https://chatgpt.com?query",
		"https://chatgpt.com#fragment",
		"codex-sandbox:",
		"codex-sandbox://unrelated.example",
		"codex-sandbox://mcp-app-xyz.web-sandbox.oaiusercontent.com",
		"codex-sandbox://mcp-app-a.web-sandbox.oaiusercontent.com.evil.test",
		"codex-sandbox://mcp-app-a.web-sandbox.oaiusercontent.com@evil.test",
		"codex-sandbox://user@mcp-app-a.web-sandbox.oaiusercontent.com",
		`${desktopOrigin}:443`,
		`${desktopOrigin}/`,
		`${desktopOrigin}/path`,
		`${desktopOrigin}?query`,
		`${desktopOrigin}#fragment`,
		`${desktopOrigin}\n`,
		"file:///tmp/haunter.html",
		"data:text/html,hi",
		"blob:https://chatgpt.com/id",
	])("rejects non-origin or unsupported parent %s", (origin) => {
		expect(isEmbeddedEditorOrigin(origin)).toBe(false);
	});

	test("adds only an explicitly configured desktop ancestor to embed routes", async () => {
		delete process.env.MCP_EMBED_ALLOWED_ORIGINS;
		const defaults = await readHeaders();
		expect(defaults).toHaveLength(1);
		expect(defaults[0]?.source).toBe("/embed/:path*");
		const defaultCsp = defaults[0]?.headers[0]?.value;
		expect(defaultCsp).not.toContain("codex-sandbox:");
		process.env.MCP_EMBED_ALLOWED_ORIGINS = desktopOrigin;
		const headers = await readHeaders();
		expect(headers[0]?.headers[0]?.value).toBe(
			`${defaultCsp} ${desktopOrigin}`,
		);
	});

	test("rejects broad scheme and wildcard ancestor configuration", async () => {
		for (const value of [
			"codex-sandbox:",
			"codex-sandbox://*.oaiusercontent.com",
			"https://*.oaiusercontent.com",
		]) {
			process.env.MCP_EMBED_ALLOWED_ORIGINS = value;
			await expect(readHeaders()).rejects.toThrow("exact HTTP(S) or Codex");
		}
	});
});
