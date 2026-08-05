import { describe, expect, it } from "bun:test";
import {
	DOCUMENT_PROVIDER_VERIFICATION_TTL_MS,
	documentId,
	isProviderVerificationFresh,
	parseDocumentId,
} from "@/features/documents/model";

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

describe("provider verification freshness", () => {
	const now = Date.parse("2026-08-04T12:00:00.000Z");

	it("accepts only ready documents verified inside the bounded window", () => {
		expect(
			isProviderVerificationFresh(
				{
					state: "ready",
					lastProviderVerifiedAt: new Date(
						now - DOCUMENT_PROVIDER_VERIFICATION_TTL_MS + 1,
					).toISOString(),
				},
				now,
			),
		).toBe(true);
		expect(
			isProviderVerificationFresh(
				{
					state: "ready",
					lastProviderVerifiedAt: new Date(
						now - DOCUMENT_PROVIDER_VERIFICATION_TTL_MS - 1,
					).toISOString(),
				},
				now,
			),
		).toBe(false);
	});

	it("rejects missing, invalid, and non-ready verification state", () => {
		for (const input of [
			{ state: "ready" as const, lastProviderVerifiedAt: null },
			{
				state: "ready" as const,
				lastProviderVerifiedAt: "not-a-date",
			},
			{
				state: "ready" as const,
				lastProviderVerifiedAt: new Date(now + 1).toISOString(),
			},
			{
				state: "seeding" as const,
				lastProviderVerifiedAt: new Date(now).toISOString(),
			},
		]) {
			expect(isProviderVerificationFresh(input, now)).toBe(false);
		}
	});
});
