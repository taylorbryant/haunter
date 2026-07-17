import { describe, expect, test } from "bun:test";
import {
	AGENT_AUTH_CLI_VERSION,
	AGENT_CLIENTS,
	AGENT_PACKAGE_RUNNERS,
	getAgentClientSetup,
	getAgentConnectionPrompt,
	HAUNTER_AGENT_AUTH_URL,
} from "@/features/agents/connect-config";

describe("agent connection setup", () => {
	test("generates a pinned Haunter configuration for every supported client", () => {
		for (const client of AGENT_CLIENTS) {
			for (const runner of AGENT_PACKAGE_RUNNERS) {
				const setup = getAgentClientSetup(client.id, runner.id);

				expect(setup.configuration).toContain(
					`@auth/agent-cli@${AGENT_AUTH_CLI_VERSION}`,
				);
				expect(setup.configuration).toContain(HAUNTER_AGENT_AUTH_URL);
				expect(setup.configuration).toContain(client.hostName);
				expect(setup.configuration).toContain(runner.command);
				expect(setup.installInstruction.length).toBeGreaterThan(0);
				expect(setup.restartInstruction.length).toBeGreaterThan(0);
			}
		}
	});

	test("uses runner-specific arguments", () => {
		expect(getAgentClientSetup("codex", "npx").configuration).toContain(
			'  "-y",',
		);
		expect(getAgentClientSetup("codex", "bunx").configuration).not.toContain(
			'  "-y",',
		);
	});

	test("uses the native configuration shape for each client family", () => {
		expect(getAgentClientSetup("codex").configuration).toContain(
			"[mcp_servers.haunter]",
		);
		expect(getAgentClientSetup("claude-code").configuration).toStartWith(
			"claude mcp add haunter --",
		);
		expect(
			JSON.parse(getAgentClientSetup("cursor").configuration),
		).toHaveProperty("mcpServers.haunter");
		expect(
			JSON.parse(getAgentClientSetup("vscode").configuration),
		).toHaveProperty("servers.haunter.type", "stdio");
	});

	test("builds a workspace-constrained connection prompt", () => {
		const prompt = getAgentConnectionPrompt({
			id: "workspace_123",
			name: "Haunted House",
		});

		expect(prompt).toContain('workspace "Haunted House"');
		expect(prompt).toContain('workspaceId: "workspace_123"');
		expect(prompt).toContain('constraints.workspaceId set to "workspace_123"');
		expect(prompt).toContain("read-only or read/write");
	});
});
