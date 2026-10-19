import { parseArgs } from "node:util";

const options = {
	help: { type: "boolean", short: "h" },
	version: { type: "boolean", short: "v" },
	json: { type: "boolean" },
	server: { type: "string" },
	workspace: { type: "string", short: "w" },
	title: { type: "string" },
	page: { type: "string" },
	parent: { type: "string" },
	file: { type: "string" },
	due: { type: "string" },
	filter: { type: "string" },
	scope: { type: "string" },
	limit: { type: "string" },
	port: { type: "string" },
	"no-browser": { type: "boolean" },
} as const;

const commands: Record<string, { args: number; flags: string[] }> = {
	login: { args: 0, flags: ["port", "no-browser"] },
	logout: { args: 0, flags: [] },
	status: { args: 0, flags: [] },
	"workspaces list": { args: 0, flags: [] },
	"workspaces use": { args: 1, flags: [] },
	"pages list": { args: 0, flags: ["workspace"] },
	"pages search": { args: 1, flags: ["workspace"] },
	"pages read": { args: 1, flags: ["workspace"] },
	capture: { args: 1, flags: ["workspace", "title", "page", "parent", "file"] },
	"tasks list": {
		args: 0,
		flags: ["workspace", "filter", "scope", "limit", "due"],
	},
	"tasks add": { args: 1, flags: ["workspace", "due"] },
	"tasks done": { args: 1, flags: ["workspace"] },
};

export function parseArguments(args: string[]) {
	const parsed = parseArgs({
		args,
		options,
		allowPositionals: true,
		strict: true,
		tokens: true,
	});
	const { values, positionals, tokens } = parsed;
	const group = positionals[0];
	const grouped = ["pages", "tasks", "workspaces"].includes(group);
	const command = grouped ? `${group} ${positionals[1] ?? ""}`.trim() : group;
	const operands = positionals.slice(grouped ? 2 : 1);
	if (values.help || values.version || !group)
		return { command, operands, values, help: !values.version };
	const spec = commands[command];
	if (!spec)
		throw new Error(`Unknown command: ${command}. Run haunter --help.`);
	if (
		operands.length > spec.args ||
		(command !== "capture" && operands.length !== spec.args)
	) {
		throw new Error(
			`${command} expects ${spec.args ? "one argument (quote text containing spaces)" : "no arguments"}. Run haunter --help.`,
		);
	}
	const seen = new Set<string>();
	for (const token of tokens) {
		if (token.kind !== "option") continue;
		if (seen.has(token.name))
			throw new Error(`Specify --${token.name} only once.`);
		seen.add(token.name);
		if (!["json", "server", ...spec.flags].includes(token.name))
			throw new Error(`--${token.name} is not supported by ${command}.`);
		if (typeof token.value === "string" && !token.value.trim())
			throw new Error(`--${token.name} cannot be empty.`);
	}
	if (operands.some((value) => !value.trim()))
		throw new Error("Arguments cannot be empty.");
	if (command === "capture") {
		if (values.page && (values.title || values.parent))
			throw new Error(
				"--page appends to an existing page; do not combine it with --title or --parent.",
			);
		if (operands.length && values.file)
			throw new Error("Pass capture text or --file, not both.");
	}
	if (values.port) integer(values.port, "port", 1, 65535);
	if (values.limit) integer(values.limit, "limit", 1, 200);
	if (values.filter && !["open", "completed", "all"].includes(values.filter))
		throw new Error("--filter must be open, completed, or all.");
	if (values.scope && !["mine", "everyone"].includes(values.scope))
		throw new Error("--scope must be mine or everyone.");
	if (values.due) {
		if (command === "tasks list") {
			if (!["today", "overdue", "upcoming"].includes(values.due))
				throw new Error(
					"--due must be today, overdue, or upcoming for tasks list.",
				);
		} else if (
			!/^\d{4}-\d{2}-\d{2}$/.test(values.due) ||
			Number.isNaN(Date.parse(values.due)) ||
			new Date(values.due).toISOString().slice(0, 10) !== values.due
		) {
			throw new Error(
				"--due must be a valid date in YYYY-MM-DD format for tasks add.",
			);
		}
	}
	return { command, operands, values, help: false };
}

function integer(value: string, flag: string, min: number, max: number) {
	if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
		throw new Error(`--${flag} must be an integer from ${min} to ${max}.`);
}

export const HELP = `Haunter — pages, notes, and tasks from your terminal

Usage: haunter <command> [options]

  login                         Sign in through your browser
    --no-browser                Print the sign-in URL without opening it
    --port <port>               Loopback callback port (default: 43821)
  logout                        Remove locally saved sign-in credentials
  status                        Show local sign-in and workspace settings
  workspaces list               List workspaces you approved
  workspaces use <id>            Save the default workspace for this server
  pages list                    List pages
  pages search <query>           Search pages (quote phrases)
  pages read <id>                Print a page as Markdown
  capture [text]                Create a page from text, a file, or stdin
    --title <title>              New page title (default: first nonempty line)
    --file <path>               Read Markdown from a file; use - for stdin
    --parent <id>               Create under an existing page
    --page <id>                 Append to an existing page instead
  tasks list                    List your open tasks
    --filter <open|completed|all>
    --scope <mine|everyone>
    --due <today|overdue|upcoming>
    --limit <1-200>              Maximum tasks (default: 50)
  tasks add <title>              Create a task; optional --due YYYY-MM-DD
  tasks done <id>                Complete a task

Options:
  -w, --workspace <id>           Override the saved workspace for a command
  --server <url>                Haunter URL (default: https://www.haunter.app/mcp)
  --json                        Write JSON to stdout; errors go to stderr
  -h, --help                    Show this help
  -v, --version                 Show the CLI version

Examples:
  haunter login
  haunter workspaces use <id>
  haunter capture "An idea for later"
  cat meeting.md | haunter capture --title "Meeting notes"
  haunter capture --file notes.md --page <id>
  haunter tasks list --due today --json

Environment: HAUNTER_SERVER, HAUNTER_WORKSPACE, HAUNTER_CONFIG_DIR
`;
