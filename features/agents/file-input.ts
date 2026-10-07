import { z } from "zod";

export const MAX_AGENT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_INLINE_FILE_BYTES = 2 * 1024 * 1024;
// OpenAI requires these four declared properties, with only URL and ID required.
export const HostFileSchema = z
	.object({
		download_url: z.string().min(1).max(16_384),
		file_id: z.string().min(1).max(500),
		mime_type: z.string().max(200).optional(),
		file_name: z.string().max(500).optional(),
	})
	.strict();
export const AgentFileSourceSchema = z.object({
	file: HostFileSchema.optional().describe(
		"A file supplied by the host. Do not invent file IDs or download URLs.",
	),
	inlineFile: z
		.object({
			name: z.string().min(1).max(500),
			mimeType: z.string().min(1).max(200),
			data: z
				.string()
				.min(4)
				.max(4 * Math.ceil(MAX_INLINE_FILE_BYTES / 3)),
		})
		.strict()
		.optional()
		.describe(
			"Fallback for clients without file transfer: real file bytes as standard base64, at most 2 MiB. No data URL prefix.",
		),
});
export type AgentFileSource = z.infer<typeof AgentFileSourceSchema>;
export const hasOneFileSource = (input: AgentFileSource) =>
	Number(!!input.file) + Number(!!input.inlineFile) === 1;
export interface AgentFilesPort {
	read(
		source: AgentFileSource,
		options?: { imageOnly?: boolean },
	): Promise<{
		bytes: Uint8Array;
		name: string;
		mimeType: string;
		width?: number;
		height?: number;
	}>;
}
