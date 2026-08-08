import { describe, expect, test } from "bun:test";
import { ErrorResponseSchema } from "@/features/shared/schemas";

describe("shared response schemas", () => {
	test("preserves the existing error response envelope", () => {
		expect(
			ErrorResponseSchema.parse({
				code: "INTERNAL_SERVER_ERROR",
				message: "Something went wrong",
				requestId: "request_1",
			}),
		).toEqual({
			code: "INTERNAL_SERVER_ERROR",
			message: "Something went wrong",
			requestId: "request_1",
		});
		expect(
			ErrorResponseSchema.safeParse({ code: 500, message: "Invalid" }).success,
		).toBe(false);
	});
});
