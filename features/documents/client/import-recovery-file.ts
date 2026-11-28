"use client";

import { apiClient } from "@/client";
import { importRecovery, stageRecoveryPart } from "../contracts";
import { MAX_RECOVERY_FILE_BYTES, RECOVERY_PART_BYTES } from "../recovery";
import { encodeRecoveryUpdate } from "../update-encoding";

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function importRecoveryFile(input: {
	idempotencyKey: string;
	body: { workspaceId: string; filename: string; file: string };
}) {
	const { workspaceId, filename, file } = input.body;
	const encoder = new TextEncoder();
	// Escaping the nested JSON string can make the request larger than the file.
	if (
		file.length < 150_000 ||
		encoder.encode(JSON.stringify(input.body)).byteLength <= 1024 * 1024
	)
		return apiClient.endpoint(importRecovery).call(input);

	const bytes = encoder.encode(file);
	if (bytes.length > MAX_RECOVERY_FILE_BYTES)
		throw new Error("Recovery files must be 5 MB or smaller.");
	const digest = await sha256(bytes);
	const uploadId = await sha256(encoder.encode(input.idempotencyKey));
	const parts = Math.ceil(bytes.length / RECOVERY_PART_BYTES);
	for (let part = 0; part < parts; part++) {
		const start = part * RECOVERY_PART_BYTES;
		await apiClient.endpoint(stageRecoveryPart).call({
			body: {
				workspaceId,
				uploadId,
				part,
				data: encodeRecoveryUpdate(
					bytes.subarray(start, start + RECOVERY_PART_BYTES),
				),
			},
		});
	}
	return apiClient
		.endpoint(importRecovery)
		.call({
			idempotencyKey: input.idempotencyKey,
			body: { workspaceId, filename, uploadId, digest, parts },
		});
}
