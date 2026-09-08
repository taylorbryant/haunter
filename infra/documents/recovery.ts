import * as Y from "yjs";
import type { DocumentRecoveryPort } from "@/features/documents/ports";
import { CreatePageInputSchema } from "@/features/pages/schemas";
import { appError } from "@/features/shared/errors";

const contentSchema = CreatePageInputSchema.shape.initialContent.unwrap();
export const documentRecovery: DocumentRecoveryPort = {
	async decodeCanvas(update) {
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, Uint8Array.from(update));
			if (doc.store.pendingStructs || doc.store.pendingDs)
				throw new Error("Incomplete canvas");
			const { projectCanvas } = await import("@/infra/documents/legacy-canvas");
			return { ...projectCanvas(doc) };
		} catch {
			throw appError("InvalidPageContent", {
				message: "The recovery file contains an invalid canvas.",
			});
		} finally {
			doc.destroy();
		}
	},
	async decode(update) {
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, Uint8Array.from(update));
			if (doc.store.pendingStructs || doc.store.pendingDs)
				throw new Error("Incomplete document update");
			const { projectPageBody } = await import("./codec");
			return contentSchema.parse(projectPageBody(doc));
		} catch {
			throw appError("InvalidPageContent", {
				message:
					"The recovery file contains an incomplete, invalid, or unsupported collaborative document.",
			});
		} finally {
			doc.destroy();
		}
	},
	async normalize(content) {
		try {
			const { seedPageBody, projectPageBody } = await import("./codec");
			const doc = seedPageBody(contentSchema.parse(content));
			try {
				return contentSchema.parse(projectPageBody(doc));
			} finally {
				doc.destroy();
			}
		} catch {
			throw appError("InvalidPageContent", {
				message: "The recovery file contains unsupported page content.",
			});
		}
	},
};
