import { describe, expect, it } from "bun:test";
import {
	HtmlExportError,
	pageHtmlSourceUrl,
	resolveHtmlExportTheme,
	resolveHtmlImageUrls,
} from "@/features/pages/client/html-files";

const baseOptions = {
	baseUrl: "https://haunter.app/w/workspace/p/page",
	origin: "https://haunter.app",
	toDataUrl: async (blob: Blob) =>
		`data:${blob.type};base64,${"A".repeat(blob.size)}`,
};

describe("HTML image embedding", () => {
	it("bounds private image fetches while leaving public URLs external", async () => {
		let active = 0;
		let maxActive = 0;
		let fetchCount = 0;
		const privateUrls = Array.from(
			{ length: 6 },
			(_, index) => `/api/files/image-${index}.png`,
		);
		const resolved = await resolveHtmlImageUrls(
			[...privateUrls, "/icon.svg", "https://images.example.com/photo.png"],
			{
				...baseOptions,
				concurrency: 2,
				async fetchImage() {
					fetchCount += 1;
					active += 1;
					maxActive = Math.max(maxActive, active);
					await new Promise((resolve) => setTimeout(resolve, 2));
					active -= 1;
					return new Blob(["image"], { type: "image/png" });
				},
			},
		);

		expect(fetchCount).toBe(privateUrls.length);
		expect(maxActive).toBe(2);
		expect(resolved.get(privateUrls[0])).toStartWith("data:image/png;base64,");
		expect(resolved.get("/icon.svg")).toBe("https://haunter.app/icon.svg");
		expect(resolved.get("https://images.example.com/photo.png")).toBe(
			"https://images.example.com/photo.png",
		);
	});

	it("fails explicitly when a private image cannot be embedded", async () => {
		await expect(
			resolveHtmlImageUrls(["/api/files/missing.png"], {
				...baseOptions,
				fetchImage: async () => {
					throw new Error("Unauthorized");
				},
			}),
		).rejects.toBeInstanceOf(HtmlExportError);
	});

	it("enforces an aggregate embedded image budget", async () => {
		await expect(
			resolveHtmlImageUrls(["/api/files/one.png", "/api/files/two.png"], {
				...baseOptions,
				maxBytes: 5,
				fetchImage: async () => new Blob(["four"], { type: "image/png" }),
			}),
		).rejects.toThrow("more than 5 bytes");
	});
});

describe("HTML source URL", () => {
	it("builds the exported page URL from the page captured at click time", () => {
		expect(
			pageHtmlSourceUrl(
				"https://haunter.app",
				"workspace/with slash",
				"page/with slash",
			),
		).toBe(
			"https://haunter.app/w/workspace%2Fwith%20slash/p/page%2Fwith%20slash",
		);
	});
});

describe("HTML theme capture", () => {
	it("prefers the visibly applied theme over a stale React theme value", () => {
		expect(resolveHtmlExportTheme("light", ["dracula"]).id).toBe("dracula");
	});

	it("falls back to the resolved theme when no app theme class is applied", () => {
		expect(resolveHtmlExportTheme("alucard", ["font-sans"]).id).toBe("alucard");
	});
});
