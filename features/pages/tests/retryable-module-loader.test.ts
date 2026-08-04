import { describe, expect, it } from "bun:test";
import { createRetryableModuleLoader } from "@/features/pages/components/retryable-module-loader";

describe("retryable module loader", () => {
	it("retries after a rejected load and caches the successful module", async () => {
		let attempts = 0;
		const module = { editor: "ready" };
		const loader = createRetryableModuleLoader(async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("stale chunk");
			return module;
		});

		await expect(loader.load()).rejects.toThrow("stale chunk");
		expect(loader.loaded).toBeNull();
		expect(await loader.load()).toBe(module);
		expect(await loader.load()).toBe(module);
		expect(attempts).toBe(2);
	});

	it("shares one promise between concurrent callers", async () => {
		const deferred = Promise.withResolvers<{ editor: string }>();
		const loader = createRetryableModuleLoader(() => deferred.promise);

		const first = loader.load();
		const second = loader.load();
		expect(first).toBe(second);
		deferred.resolve({ editor: "ready" });
		expect(await first).toEqual({ editor: "ready" });
	});
});
