import sharp from "sharp";
import {
	type AgentFilesPort,
	hasOneFileSource,
	MAX_AGENT_FILE_BYTES,
	MAX_INLINE_FILE_BYTES,
} from "@/features/agents/file-input";
import {
	ATTACHMENT_TYPES,
	ATTACHMENT_CONTENT_TYPES,
	safeAttachmentName,
} from "@/features/pages/attachments";
import { appError } from "@/features/shared/errors";
import { downloadAgentFile } from "./file-download";

const invalid = (message: string): never => {
	throw appError("UnsupportedAttachment", { message });
};
export function decodeFileBase64(
	data: string,
	maxBytes = MAX_INLINE_FILE_BYTES,
): Buffer {
	if (
		data.length > 4 * Math.ceil(maxBytes / 3) ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			data,
		)
	)
		return invalid(
			"Supply valid standard base64 file bytes within the size limit.",
		);
	const bytes = Buffer.from(data, "base64");
	if (
		!bytes.length ||
		bytes.length > maxBytes ||
		bytes.toString("base64") !== data
	)
		return invalid("Invalid or oversized file bytes.");
	return bytes;
}
export async function normalizeAgentImage(bytes: Uint8Array) {
	// Exclude SVG and other active/external formats before invoking a decoder.
	const b = Buffer.from(bytes);
	if (
		!(
			b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" ||
			b.subarray(0, 3).toString("hex") === "ffd8ff" ||
			/^GIF8[79]a$/.test(b.subarray(0, 6).toString()) ||
			(b.subarray(0, 4).toString() === "RIFF" &&
				b.subarray(8, 12).toString() === "WEBP")
		)
	)
		return invalid("Use a PNG, JPEG, GIF or WebP image.");
	try {
		const { data, info } = await sharp(b, {
			limitInputPixels: 16_000_000,
			failOn: "warning",
			pages: 1,
		})
			.timeout({ seconds: 5 })
			.rotate()
			.png()
			.toBuffer({ resolveWithObject: true });
		if (data.length > MAX_INLINE_FILE_BYTES)
			return invalid(
				"The decoded image exceeds 2 MiB. Resize or compress it first.",
			);
		return {
			bytes: data,
			width: info.width,
			height: info.height,
			mimeType: "image/png" as const,
		};
	} catch {
		return invalid(
			"The image is invalid or exceeds the 16 megapixel / 2 MiB decoded limit.",
		);
	}
}

export function createAgentFiles(download = downloadAgentFile): AgentFilesPort {
	return {
		async read(source, options) {
			if (!hasOneFileSource(source))
				return invalid("Supply exactly one of file or inlineFile.");
			const downloaded = source.file
				? await download(source.file.download_url)
				: null;
			const bytes =
				downloaded?.bytes ?? decodeFileBase64(source.inlineFile!.data);
			if (!bytes.length || bytes.length > MAX_AGENT_FILE_BYTES)
				return invalid("Files must be nonempty and at most 10 MiB.");
			const name = safeAttachmentName(
				source.inlineFile?.name ?? source.file?.file_name ?? "attachment",
			);
			const extensionType =
				ATTACHMENT_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
			const declared = (
				source.inlineFile?.mimeType ??
				source.file?.mime_type ??
				downloaded?.contentType ??
				""
			)
				.split(";")[0]!
				.trim()
				.toLowerCase();
			const mimeType =
				declared && declared !== "application/octet-stream"
					? declared
					: extensionType;
			if (!mimeType || !ATTACHMENT_CONTENT_TYPES.includes(mimeType))
				return invalid(
					"Unsupported file type. Supply its MIME type and filename.",
				);
			if (options?.imageOnly || mimeType.startsWith("image/")) {
				const image = await normalizeAgentImage(bytes);
				return { ...image, name: name.replace(/\.[^.]+$/, "") + ".png" };
			}
			if (
				mimeType === "application/pdf" &&
				bytes.subarray(0, 5).toString() !== "%PDF-"
			)
				return invalid("The file is not a PDF.");
			if (
				mimeType.includes("officedocument") &&
				bytes.subarray(0, 4).toString("hex") !== "504b0304"
			)
				return invalid("The file is not an Office document.");
			if (mimeType.startsWith("text/") || mimeType === "application/json") {
				try {
					new TextDecoder("utf-8", { fatal: true }).decode(bytes);
				} catch {
					return invalid("Text files must be UTF-8.");
				}
			}
			return { bytes, mimeType, name };
		},
	};
}
