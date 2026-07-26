import "@beignet/core/server-only";
import { createProvider } from "@beignet/core/providers";
import { after } from "next/server";
import type { AfterResponsePort } from "@/ports";

export const nextAfterResponseProvider = createProvider()({
	name: "next-after-response",
	setup() {
		const afterResponse: AfterResponsePort = {
			schedule(work) {
				after(work);
			},
		};

		return { ports: { afterResponse } };
	},
});
