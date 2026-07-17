import { describe, expect, test } from "bun:test";
import {
	CreatePageInputSchema,
	PAGE_TITLE_MAX_LENGTH,
	PAGE_TITLE_TOO_LONG_MESSAGE,
	UpdatePageBodySchema,
} from "@/features/pages/schemas";

describe("page title validation", () => {
	test("accepts a title at the documented limit", () => {
		const result = UpdatePageBodySchema.safeParse({
			title: "a".repeat(PAGE_TITLE_MAX_LENGTH),
		});

		expect(result.success).toBe(true);
	});

	test("returns a user-facing error above the limit", () => {
		const result = CreatePageInputSchema.safeParse({
			workspaceId: "workspace-1",
			title: "a".repeat(PAGE_TITLE_MAX_LENGTH + 1),
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues[0]?.message).toBe(PAGE_TITLE_TOO_LONG_MESSAGE);
	});
});
