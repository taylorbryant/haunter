import { createReadStream } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { version } from "../package.json";
import { HELP, parseArguments } from "./args";
import { login } from "./auth";
import { connect, type HaunterClient } from "./client";
import { isCliTool, readToolInput, toolValidator } from "./tools";
import {
	configDirectory,
	DEFAULT_SERVER,
	ProfileStore,
	serverUrl,
} from "./config";

const workspaceResult = z.object({
	workspaces: z.array(
		z
			.object({ id: z.string(), name: z.string(), role: z.string() })
			.passthrough(),
	),
});
const pagesResult = z.object({
	pages: z.array(
		z.object({ pageId: z.string(), title: z.string() }).passthrough(),
	),
});
const pageResult = z.object({ title: z.string(), markdown: z.string() });
const taskRow = z
	.object({
		taskId: z.string(),
		title: z.string(),
		completed: z.boolean(),
		dueDate: z.string().nullable().optional(),
	})
	.passthrough();
const tasksResult = z.object({ tasks: z.array(taskRow), hasMore: z.boolean() });
const savedPage = z.object({ pageId: z.string(), title: z.string() });

export type CliIO = {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	stdin: AsyncIterable<Uint8Array | string>;
	isTTY: boolean;
	env: Record<string, string | undefined>;
	signal?: AbortSignal;
};
export type CliDependencies = { connect: typeof connect; login: typeof login };

export async function runCli(
	args: string[],
	io: CliIO,
	dependencies: CliDependencies = { connect, login },
): Promise<number> {
	let secrets: string[] = [];
	let release: (() => Promise<void>) | undefined;
	let client: HaunterClient | undefined;
	let json = args.includes("--json");
	const write = (data: unknown, text: string) =>
		io.stdout(json ? `${JSON.stringify(data)}\n` : `${safeText(text)}\n`);
	try {
		const { command, operands, values, help } = parseArguments(args);
		json = Boolean(values.json);
		if (values.version) {
			write({ version }, version);
			return 0;
		}
		if (help) {
			write({ help: HELP }, HELP.trimEnd());
			return 0;
		}
		const server = serverUrl(
			values.server ?? io.env.HAUNTER_SERVER ?? DEFAULT_SERVER,
		);
		const store = new ProfileStore(configDirectory(io.env), server);
		release = await store.lock();
		const profile = await store.load();
		secrets = [
			profile.tokens?.access_token,
			profile.tokens?.refresh_token,
			profile.client?.client_secret,
		].filter((value): value is string => Boolean(value));
		if (command === "status") {
			const status = {
				server,
				signedIn: Boolean(profile.tokens),
				workspaceId: profile.workspaceId ?? null,
			};
			write(
				status,
				`${status.signedIn ? "Credentials saved" : "Signed out"}\nServer: ${server}\nWorkspace: ${status.workspaceId ?? "not selected"}`,
			);
			return 0;
		}
		if (command === "logout") {
			delete profile.tokens;
			delete profile.workspaceId;
			await store.save(profile);
			write(
				{ signedIn: false, server },
				"Local credentials removed. To revoke the connection, disconnect Haunter CLI in Haunter → Settings → Agents.",
			);
			return 0;
		}
		if (command === "login") {
			await dependencies.login(store, profile, {
				port: values.port ? Number(values.port) : undefined,
				noBrowser: values["no-browser"],
				signal: io.signal,
				notice: (text) => io.stderr(`${safeText(text)}\n`),
			});
			write(
				{ signedIn: true, server },
				"Signed in. Run haunter workspaces list, then haunter workspaces use <id>.",
			);
			return 0;
		}
		// Read and validate capture input before making any network requests.
		const markdown =
			command === "capture"
				? await captureText(operands[0], values.file, io)
				: undefined;
		const toolInput =
			command === "tools call" ? await readToolInput(values.input, io) : {};
		client = await dependencies.connect(store, profile, io.signal);
		if (command.startsWith("tools ")) {
			const tools = (await client.listTools()).filter(isCliTool);
			if (command === "tools list") {
				write(
					{ tools },
					tools
						.map(
							(tool) =>
								`${tool.name}\t${oneLine(tool.description ?? tool.title ?? "")}`,
						)
						.join("\n") ||
						"No tools available. Run haunter login to review access.",
				);
				return 0;
			}
			const tool = tools.find((item) => item.name === operands[0]);
			if (!tool)
				throw new Error(
					`Tool ${operands[0]} is not available to this connection. Run haunter tools list, or haunter login to review access.`,
				);
			if (command === "tools describe") {
				write(tool, JSON.stringify(tool, null, 2));
				return 0;
			}
			if (tool.execution?.taskSupport === "required")
				throw new Error(
					`${tool.name} requires MCP task support, which this CLI does not support.`,
				);
			if (Object.hasOwn(tool.inputSchema.properties ?? {}, "workspaceId")) {
				if (Object.hasOwn(toolInput, "workspaceId")) {
					if (values.workspace && values.workspace !== toolInput.workspaceId)
						throw new Error(
							"--workspace conflicts with workspaceId in the JSON input.",
						);
				} else {
					toolInput.workspaceId = await resolveWorkspace(
						client,
						values.workspace ?? io.env.HAUNTER_WORKSPACE ?? profile.workspaceId,
					);
				}
			} else if (values.workspace) {
				throw new Error(`${tool.name} does not accept --workspace.`);
			}
			const validation = toolValidator(tool.inputSchema, tool.name)(toolInput);
			if (!validation.valid)
				throw new Error(
					`Invalid arguments for ${tool.name}: ${validation.errorMessage}`,
				);
			// Compile before sending a possible mutation, so unsupported schemas fail early.
			const validateOutput = tool.outputSchema
				? toolValidator(tool.outputSchema, tool.name)
				: undefined;
			const result = await client.callTool(tool.name, toolInput);
			// Preserve content, structuredContent, and metadata, including error results.
			write(result, JSON.stringify(result, null, 2));
			if (result.isError)
				throw new Error(`${tool.name} failed. See the tool result on stdout.`);
			if (validateOutput && !validateOutput(result.structuredContent).valid)
				throw new Error(
					`${tool.name} returned a result that does not match its output schema. The call was sent; check Haunter before repeating it.`,
				);
			return 0;
		}
		if (command === "workspaces list" || command === "workspaces use") {
			const result = workspaceResult.parse(
				await client.call("list_workspaces", {}),
			);
			if (command === "workspaces list")
				write(
					result,
					result.workspaces
						.map((w) => `${w.id}\t${oneLine(w.name)}\t${w.role}`)
						.join("\n") ||
						"No workspaces available. Run haunter login to review access.",
				);
			else {
				const selected = result.workspaces.find((w) => w.id === operands[0]);
				if (!selected)
					throw new Error(
						"Workspace not available. Choose an ID from haunter workspaces list.",
					);
				profile.workspaceId = selected.id;
				await store.save(profile);
				write(selected, `Using ${oneLine(selected.name)} (${selected.id}).`);
			}
			return 0;
		}
		const workspaceId = await resolveWorkspace(
			client,
			values.workspace ?? io.env.HAUNTER_WORKSPACE ?? profile.workspaceId,
		);
		const workspace = { workspaceId };
		if (command === "pages list" || command === "pages search") {
			const result = pagesResult.parse(
				await client.call(
					command === "pages list" ? "list_pages" : "search_pages",
					{
						...workspace,
						...(command === "pages search" ? { query: operands[0] } : {}),
					},
				),
			);
			write(
				result,
				result.pages
					.map((p) => `${p.pageId}\t${oneLine(p.title || "Untitled")}`)
					.join("\n") || "No pages found.",
			);
		} else if (command === "pages read") {
			const result = await client.call("read_page", {
				...workspace,
				pageId: uuid(operands[0]),
				format: "markdown",
			});
			write(result, pageResult.parse(result).markdown);
		} else if (command === "capture") {
			const title =
				(values.title ??
					markdown
						?.split(/\r?\n/)
						.find((line) => line.trim())
						?.replace(/^#+\s*/, "")
						.trim()
						.slice(0, 120)) ||
				"Untitled";
			const result = await client.call(
				values.page ? "append_to_page" : "create_page",
				{
					...workspace,
					markdown,
					...(values.page
						? { pageId: uuid(values.page) }
						: {
								title,
								...(values.parent ? { parentPageId: uuid(values.parent) } : {}),
							}),
				},
			);
			const page = savedPage.parse(result);
			write(
				result,
				`${values.page ? "Appended to" : "Created"} ${oneLine(page.title)}\n${page.pageId}`,
			);
		} else if (command === "tasks list") {
			const result = tasksResult.parse(
				await client.call("list_tasks", {
					...workspace,
					filter: values.filter ?? "open",
					scope: values.scope ?? "mine",
					limit: values.limit ? Number(values.limit) : 50,
					...(values.due ? { due: values.due } : {}),
				}),
			);
			write(
				result,
				result.tasks
					.map(
						(t) =>
							`${t.completed ? "[x]" : "[ ]"} ${t.taskId}\t${oneLine(t.title)}${t.dueDate ? `\t${t.dueDate}` : ""}`,
					)
					.join("\n") || "No tasks found.",
			);
			if (result.hasMore && !json)
				io.stderr(
					"More tasks are available. Narrow the filters or increase --limit (maximum 200).\n",
				);
		} else {
			const result = await client.call(
				command === "tasks add" ? "create_task" : "complete_task",
				{
					...workspace,
					...(command === "tasks add"
						? {
								title: operands[0],
								...(values.due ? { dueDate: values.due } : {}),
							}
						: { taskId: uuid(operands[0]) }),
				},
			);
			const task = taskRow.parse(result);
			write(
				result,
				`${command === "tasks add" ? "Created" : "Completed"} ${oneLine(task.title)}\n${task.taskId}`,
			);
		}
		return 0;
	} catch (error) {
		let message = io.signal?.aborted
			? "Cancelled."
			: error instanceof z.ZodError
				? "Haunter returned an unexpected response. Update the CLI and try again."
				: error instanceof Error
					? error.message
					: "Haunter could not complete the command.";
		for (const secret of secrets)
			message = message.replaceAll(secret, "[redacted]");
		io.stderr(
			json
				? `${JSON.stringify({ error: safeText(message) })}\n`
				: `haunter: ${safeText(message)}\n`,
		);
		return io.signal?.aborted ? 130 : 1;
	} finally {
		await client?.close().catch(() => {});
		await release?.().catch(() => {
			const error =
				"Could not remove the command lock. Check the configuration directory before retrying.";
			io.stderr(
				json ? `${JSON.stringify({ error })}\n` : `haunter: ${error}\n`,
			);
		});
	}
}

async function resolveWorkspace(
	client: HaunterClient,
	selected: string | undefined,
) {
	if (selected) return selected;
	const result = workspaceResult.parse(
		await client.call("list_workspaces", {}),
	);
	if (result.workspaces.length !== 1)
		throw new Error(
			"Select a workspace with haunter workspaces use <id>, or pass --workspace <id>.",
		);
	return result.workspaces[0].id;
}

function uuid(value: string) {
	if (!z.uuid().safeParse(value).success)
		throw new Error("Expected a page or task ID in UUID format.");
	return value;
}

async function captureText(
	text: string | undefined,
	file: string | undefined,
	io: CliIO,
) {
	if (text !== undefined) {
		// An explicit text argument wins; do not wait for an unrelated open pipe.
		if (text.length > 100_000)
			throw new Error("Capture text exceeds 100,000 characters.");
		return text;
	}
	if (!file && io.isTTY)
		throw new Error(
			"Provide capture text, --file <path>, or pipe Markdown into haunter capture.",
		);
	const input = file && file !== "-" ? createReadStream(file) : io.stdin;
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of input) {
		io.signal?.throwIfAborted();
		const buffer = Buffer.from(chunk);
		bytes += buffer.length;
		if (bytes > 400_000)
			throw new Error("Capture text exceeds 100,000 characters.");
		chunks.push(buffer);
	}
	const markdown = Buffer.concat(chunks).toString("utf8");
	if (!markdown.trim()) throw new Error("There is no text to capture.");
	if (markdown.length > 100_000)
		throw new Error("Capture text exceeds 100,000 characters.");
	return markdown;
}

export function safeText(value: string) {
	return stripVTControlCharacters(value).replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Remove terminal control characters from server-supplied text.
		/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g,
		"",
	);
}
function oneLine(value: string) {
	return safeText(value).replace(/\s+/g, " ");
}
