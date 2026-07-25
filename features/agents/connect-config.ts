export const AGENT_AUTH_CLI_VERSION = "0.5.1";
export const HAUNTER_AGENT_AUTH_URL = "https://haunter.app";

export const AGENT_PACKAGE_RUNNERS = [
	{ id: "npx", label: "npm", command: "npx" },
	{ id: "bunx", label: "Bun", command: "bunx" },
] as const;

export type AgentPackageRunnerId = (typeof AGENT_PACKAGE_RUNNERS)[number]["id"];

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

function remoteMcpJson(resourceUrl: string) {
	return JSON.stringify(
		{
			mcpServers: {
				haunter: {
					url: resourceUrl,
				},
			},
		},
		null,
		2,
	);
}

function remoteVsCodeJson(resourceUrl: string) {
	return JSON.stringify(
		{
			servers: {
				haunter: {
					type: "http",
					url: resourceUrl,
				},
			},
		},
		null,
		2,
	);
}

type ConnectionWorkspace = {
	id: string;
	name: string;
};

function cliPackage() {
	return `@auth/agent-cli@${AGENT_AUTH_CLI_VERSION}`;
}

function getPackageRunner(id: AgentPackageRunnerId) {
	const runner = AGENT_PACKAGE_RUNNERS.find((candidate) => candidate.id === id);
	if (!runner) throw new Error(`Unknown package runner: ${id}`);
	return runner;
}

function stdioArgs(hostName: string, runnerId: AgentPackageRunnerId) {
	return [
		...(runnerId === "npx" ? ["-y"] : []),
		cliPackage(),
		"mcp",
		"--url",
		HAUNTER_AGENT_AUTH_URL,
		"--host-name",
		hostName,
	];
}

function mcpServersJson(hostName: string, runnerId: AgentPackageRunnerId) {
	const runner = getPackageRunner(runnerId);
	return JSON.stringify(
		{
			mcpServers: {
				haunter: {
					command: runner.command,
					args: stdioArgs(hostName, runnerId),
				},
			},
		},
		null,
		2,
	);
}

function vscodeJson(hostName: string, runnerId: AgentPackageRunnerId) {
	const runner = getPackageRunner(runnerId);
	return JSON.stringify(
		{
			servers: {
				haunter: {
					type: "stdio",
					command: runner.command,
					args: stdioArgs(hostName, runnerId),
				},
			},
		},
		null,
		2,
	);
}

export function getAgentClientSetup(
	id: AgentClientId,
	runnerId: AgentPackageRunnerId = "npx",
): AgentClientSetup {
	const client = AGENT_CLIENTS.find((candidate) => candidate.id === id);
	if (!client) throw new Error(`Unknown agent client: ${id}`);
	const runner = getPackageRunner(runnerId);

	if (id === "codex") {
		return {
			configuration: `[mcp_servers.haunter]\ncommand = ${JSON.stringify(runner.command)}\nargs = [${stdioArgs(
				client.hostName,
				runnerId,
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
			configuration: `claude mcp add haunter -- ${runner.command} ${stdioArgs(
				client.hostName,
				runnerId,
			)
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
			configuration: mcpServersJson(client.hostName, runnerId),
			configurationLabel: "Claude Desktop configuration",
			installInstruction:
				"Open Settings → Developer → Edit Config and add this server.",
			restartInstruction:
				"Quit and reopen Claude Desktop after saving the file.",
		};
	}

	if (id === "cursor") {
		return {
			configuration: mcpServersJson(client.hostName, runnerId),
			configurationLabel: "Cursor MCP configuration",
			installInstruction:
				"Open Cursor Settings → Tools & Integrations → MCP Tools, then add this configuration.",
			restartInstruction: "Reload Cursor and enable the Haunter server.",
		};
	}

	if (id === "vscode") {
		return {
			configuration: vscodeJson(client.hostName, runnerId),
			configurationLabel: ".vscode/mcp.json",
			installInstruction:
				"Add this to your workspace MCP configuration, or use MCP: Open User Configuration for a global connection.",
			restartInstruction:
				"Run MCP: List Servers, then start the Haunter server.",
		};
	}

	return {
		configuration: mcpServersJson(client.hostName, runnerId),
		configurationLabel: "MCP configuration",
		installInstruction:
			"Add this local stdio server using your client's MCP configuration.",
		restartInstruction: "Restart or reload MCP servers in your client.",
	};
}

export function getHostedAgentClientSetup(
	id: AgentClientId,
	resourceUrl: string,
): AgentClientSetup {
	if (!resourceUrl) {
		return {
			configuration: "Loading Haunter MCP URL…",
			configurationLabel: "Remote MCP URL",
			installInstruction: "Add Haunter as a remote HTTP MCP server.",
			restartInstruction:
				"Open or enable Haunter in your client, then sign in when prompted.",
		};
	}

	if (id === "codex") {
		return {
			configuration: `[mcp_servers.haunter]\nurl = ${JSON.stringify(resourceUrl)}`,
			configurationLabel: "~/.codex/config.toml",
			installInstruction:
				"Add this remote server to your Codex user configuration file.",
			restartInstruction:
				"Restart Codex, open /mcp, and sign in to Haunter when prompted.",
		};
	}

	if (id === "claude-code") {
		return {
			configuration: `claude mcp add --transport http haunter ${JSON.stringify(resourceUrl)}`,
			configurationLabel: "Terminal",
			installInstruction: "Run this command in your terminal.",
			restartInstruction:
				"Start a new Claude Code session and sign in to Haunter when prompted.",
		};
	}

	if (id === "vscode") {
		return {
			configuration: remoteVsCodeJson(resourceUrl),
			configurationLabel: ".vscode/mcp.json",
			installInstruction:
				"Add this to your workspace MCP configuration, or use MCP: Open User Configuration for a global connection.",
			restartInstruction:
				"Run MCP: List Servers, start Haunter, and complete sign-in.",
		};
	}

	if (id === "claude-desktop") {
		return {
			configuration: resourceUrl,
			configurationLabel: "Remote MCP URL",
			installInstruction:
				"Open Settings → Connectors, choose Add custom connector, and enter this URL.",
			restartInstruction:
				"Connect Haunter and complete sign-in in the browser window.",
		};
	}

	return {
		configuration: remoteMcpJson(resourceUrl),
		configurationLabel:
			id === "cursor" ? "Cursor MCP configuration" : "MCP configuration",
		installInstruction:
			id === "cursor"
				? "Open Cursor Settings → Tools & Integrations → MCP Tools, then add this configuration."
				: "Add this remote HTTP server using your client's MCP configuration.",
		restartInstruction:
			id === "cursor"
				? "Reload Cursor, enable Haunter, and complete sign-in."
				: "Enable the Haunter server and complete sign-in.",
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
