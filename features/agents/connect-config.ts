export const AGENT_AUTH_CLI_VERSION = "0.6.2";
export const HAUNTER_AGENT_AUTH_URL = "https://haunter.app";

export const AGENT_CLIENTS = [
	{ id: "codex", label: "Codex", mark: "Cx", hostName: "Codex" },
	{
		id: "claude-code",
		label: "Claude Code",
		mark: "C/",
		hostName: "Claude Code",
	},
	{
		id: "claude-desktop",
		label: "Claude Desktop",
		mark: "Cd",
		hostName: "Claude Desktop",
	},
	{ id: "cursor", label: "Cursor", mark: "Cu", hostName: "Cursor" },
	{ id: "vscode", label: "VS Code", mark: "VS", hostName: "VS Code" },
	{ id: "other", label: "Other", mark: "•••", hostName: "MCP client" },
] as const;

export type AgentClientId = (typeof AGENT_CLIENTS)[number]["id"];

export type AgentClientSetup = {
	configuration: string;
	configurationLabel: string;
	installInstruction: string;
	restartInstruction: string;
};

type ConnectionWorkspace = {
	id: string;
	name: string;
};

function cliPackage() {
	return `@auth/agent-cli@${AGENT_AUTH_CLI_VERSION}`;
}

function stdioArgs(hostName: string) {
	return [
		"-y",
		cliPackage(),
		"mcp",
		"--url",
		HAUNTER_AGENT_AUTH_URL,
		"--host-name",
		hostName,
	];
}

function mcpServersJson(hostName: string) {
	return JSON.stringify(
		{
			mcpServers: {
				haunter: {
					command: "npx",
					args: stdioArgs(hostName),
				},
			},
		},
		null,
		2,
	);
}

function vscodeJson(hostName: string) {
	return JSON.stringify(
		{
			servers: {
				haunter: {
					type: "stdio",
					command: "npx",
					args: stdioArgs(hostName),
				},
			},
		},
		null,
		2,
	);
}

export function getAgentClientSetup(id: AgentClientId): AgentClientSetup {
	const client = AGENT_CLIENTS.find((candidate) => candidate.id === id);
	if (!client) throw new Error(`Unknown agent client: ${id}`);

	if (id === "codex") {
		return {
			configuration: `[mcp_servers.haunter]\ncommand = "npx"\nargs = [${stdioArgs(
				client.hostName,
			)
				.map((arg) => `\n  ${JSON.stringify(arg)}`)
				.join(",")},\n]`,
			configurationLabel: "~/.codex/config.toml",
			installInstruction:
				"Add this server to your Codex user configuration file.",
			restartInstruction: "Restart Codex so it loads the new MCP server.",
		};
	}

	if (id === "claude-code") {
		return {
			configuration: `claude mcp add haunter -- npx ${stdioArgs(client.hostName)
				.map((arg) => JSON.stringify(arg))
				.join(" ")}`,
			configurationLabel: "Terminal",
			installInstruction: "Run this command in your terminal.",
			restartInstruction:
				"Start a new Claude Code session so it loads Haunter.",
		};
	}

	if (id === "claude-desktop") {
		return {
			configuration: mcpServersJson(client.hostName),
			configurationLabel: "Claude Desktop configuration",
			installInstruction:
				"Open Settings → Developer → Edit Config and add this server.",
			restartInstruction:
				"Quit and reopen Claude Desktop after saving the file.",
		};
	}

	if (id === "cursor") {
		return {
			configuration: mcpServersJson(client.hostName),
			configurationLabel: "Cursor MCP configuration",
			installInstruction:
				"Open Cursor Settings → Tools & Integrations → MCP Tools, then add this configuration.",
			restartInstruction: "Reload Cursor and enable the Haunter server.",
		};
	}

	if (id === "vscode") {
		return {
			configuration: vscodeJson(client.hostName),
			configurationLabel: ".vscode/mcp.json",
			installInstruction:
				"Add this to your workspace MCP configuration, or use MCP: Open User Configuration for a global connection.",
			restartInstruction:
				"Run MCP: List Servers, then start the Haunter server.",
		};
	}

	return {
		configuration: mcpServersJson(client.hostName),
		configurationLabel: "MCP configuration",
		installInstruction:
			"Add this local stdio server using your client's MCP configuration.",
		restartInstruction: "Restart or reload MCP servers in your client.",
	};
}

export function getAgentConnectionPrompt(
	workspace: ConnectionWorkspace | undefined,
) {
	const workspaceInstruction = workspace
		? `Use the workspace "${workspace.name}" (workspaceId: "${workspace.id}"). For every workspace-scoped capability, pass it as an object with constraints.workspaceId set to "${workspace.id}".`
		: "Ask me which Haunter workspace to use before requesting any workspace-scoped capability.";

	return [
		"Connect to the preconfigured Haunter provider using my account.",
		workspaceInstruction,
		"Before requesting access, ask whether I want pages, tasks, or both, and whether the access should be read-only or read/write.",
		"Discover Haunter's capabilities and request only the matching capabilities.",
		"Open the approval page for me if it does not open automatically.",
	].join(" ");
}
