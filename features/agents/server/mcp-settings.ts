import "@beignet/core/server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import {
	OPENAI_SETTINGS_CAPABILITY_KEY,
	OpenAISettingsReadResultSchema,
	OpenAISettingsUpdateResultSchema,
} from "@openai/mcp-extensions";
import { z } from "zod";
import { APP_THEMES } from "@/lib/themes";
import type { EmbeddedAppearance } from "../schemas";
import { mcpInvocationMeta } from "./mcp-metadata";

// Native settings render string enums verbatim; expose labels while keeping
// the existing stable IDs in storage and the embedded HTTP API.
const themes = [{ id: "host", label: "Follow host" }, ...APP_THEMES] as const;
const ValuesSchema = z.strictObject({
	theme: z.enum(themes.map((theme) => theme.label)).meta({
		title: "Theme",
		description:
			"Appearance of Haunter inside ChatGPT. Follow host uses the host's light or dark mode.",
	}),
});
const readTool = "read_haunter_settings";
const updateTool = "update_haunter_settings";

export function registerMcpSettings(
	server: McpServer,
	input: {
		read(): Promise<EmbeddedAppearance>;
		update(appearance: EmbeddedAppearance): Promise<EmbeddedAppearance>;
		errorMessage(error: unknown): string;
	},
) {
	const capability = {
		[OPENAI_SETTINGS_CAPABILITY_KEY]: { readTool, updateTool },
	};
	server.server.registerCapabilities({
		extensions: capability,
		experimental: capability,
	});
	function values(appearance: EmbeddedAppearance) {
		return ValuesSchema.parse({
			theme: themes.find((theme) => theme.id === appearance.theme)?.label,
		});
	}
	const errorResult = (error: unknown) => ({
		isError: true,
		content: [{ type: "text" as const, text: input.errorMessage(error) }],
	});
	// Register the protocol tools directly so settings retain our titles, status
	// labels, and app-only visibility. The SDK helper doesn't expose those options.
	server.registerTool(
		readTool,
		{
			title: "Read Haunter settings",
			description: "Read your personal settings for the Haunter app.",
			inputSchema: z.strictObject({}),
			outputSchema: OpenAISettingsReadResultSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			_meta: {
				...mcpInvocationMeta("Loading settings…", "Settings loaded"),
				ui: { visibility: ["app"] },
			},
		},
		async () => {
			try {
				return {
					content: [],
					structuredContent: {
						schema: z.toJSONSchema(ValuesSchema),
						layout: [
							{
								kind: "group" as const,
								title: "Appearance",
								items: [{ kind: "property" as const, property: "theme" }],
							},
						],
						values: values(await input.read()),
					},
				};
			} catch (error) {
				return errorResult(error);
			}
		},
	);
	server.registerTool(
		updateTool,
		{
			title: "Update Haunter settings",
			description: "Save your personal settings for the Haunter app.",
			inputSchema: z.strictObject({ set: ValuesSchema }),
			outputSchema: OpenAISettingsUpdateResultSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			_meta: {
				...mcpInvocationMeta("Saving settings…", "Settings saved"),
				ui: { visibility: ["app"] },
			},
		},
		async ({ set }) => {
			try {
				const theme = themes.find((theme) => theme.label === set.theme);
				if (!theme) throw new Error("Unknown theme");
				return {
					content: [],
					structuredContent: {
						values: values(await input.update({ theme: theme.id })),
					},
				};
			} catch (error) {
				return errorResult(error);
			}
		},
	);
}
