import { describe, expect, it } from "bun:test";
import { documentId, parseDocumentId } from "@/features/documents/model";

describe("document ids", () => {
	it("round-trips authoritative page and canvas ids", () => {
		for (const kind of ["page", "canvas"] as const) {
			const entityId = crypto.randomUUID();
			expect(parseDocumentId(documentId(kind, entityId))).toEqual({
				kind,
				entityId,
			});
		}
	});

	it("rejects legacy and malformed ids", () => {
		expect(parseDocumentId(`page:${crypto.randomUUID()}`)).toBeNull();
		expect(parseDocumentId("doc:v1:page:id")).toBeNull();
		expect(parseDocumentId("doc:v2:task:id")).toBeNull();
	});
});
