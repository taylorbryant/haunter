import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { createCompanion } from "./controller";

const app = new App({ name: "Haunter", version: "1.0.0" }, {});
const extensions = new OpenAIExtensions(app);
const companion = createCompanion({
	async callTool(name, args) {
		const result = await app.callServerTool({ name, arguments: args });
		if (result.isError) {
			const text = result.content.find((item) => item.type === "text");
			throw new Error(
				text?.type === "text"
					? text.text
					: "Haunter could not complete this action.",
			);
		}
		return result.structuredContent;
	},
	async openLink(url) {
		await app.openLink({ url });
	},
	canUseContext: () =>
		app.getHostCapabilities()?.updateModelContext?.text != null,
	async setContext(text, page) {
		const params = {
			content: text ? [{ type: "text" as const, text }] : [],
			...(app.getHostCapabilities()?.updateModelContext?.structuredContent !=
			null
				? { structuredContent: page ? { haunterPage: page } : {} }
				: {}),
		};
		if (extensions.modelContext) await extensions.modelContext.update(params);
		else await app.updateModelContext(params);
	},
});

function applyHostContext() {
	const context = app.getHostContext();
	if (context?.theme) {
		applyDocumentTheme(context.theme);
		companion.applyTheme(context.theme);
	}
	document.documentElement.dataset.displayMode =
		context?.displayMode ?? "inline";
	const dimensions = context?.containerDimensions;
	const height =
		dimensions && "height" in dimensions ? dimensions.height : undefined;
	if (
		context?.displayMode === "fullscreen" &&
		height &&
		Number.isFinite(height)
	)
		document.documentElement.style.setProperty(
			"--haunter-host-height",
			`${height}px`,
		);
	else document.documentElement.style.removeProperty("--haunter-host-height");
	const current = extensions.modelContext?.getCurrent();
	if (current !== undefined)
		companion.syncContext(current?.structuredContent?.haunterPage ?? null);
}

let initialized = false;
let initialResult: unknown;
let receivedResult = false;
let failedResult = false;
let resolveFirstResult: () => void = () => {};
const firstResult = new Promise<void>((resolve) => {
	resolveFirstResult = resolve;
});
function renderInitialResult() {
	if (failedResult) {
		companion.showConnectionError(
			"Haunter could not open this panel. Refresh to check access again.",
		);
		return Promise.resolve();
	}
	return companion.initialize(initialResult);
}
app.ontoolresult = (result) => {
	initialResult = result.structuredContent;
	receivedResult = true;
	failedResult = result.isError === true;
	resolveFirstResult();
	if (initialized)
		void renderInitialResult().catch(() =>
			companion.showConnectionError(
				"Haunter returned an unexpected response. Refresh to try again.",
			),
		);
};
app.onteardown = async () => {
	await companion.prepareClose();
	companion.dispose();
	return {};
};
app.addEventListener("hostcontextchanged", applyHostContext);

try {
	await app.connect(undefined, { timeout: 15_000 });
	applyHostContext();
	// Hosts deliver the initial tool result after initialization. Reuse it rather
	// than duplicating a workspace fetch while that notification is in flight.
	if (!receivedResult) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			firstResult,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, 5_000);
			}),
		]);
		clearTimeout(timer);
	}
	initialized = true;
	if (receivedResult) await renderInitialResult();
	else await companion.reload();
} catch {
	companion.showConnectionError(
		"Open this panel in an MCP Apps host to connect to Haunter. If it is already open there, reopen it to reconnect.",
	);
}
