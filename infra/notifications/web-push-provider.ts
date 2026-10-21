import "@beignet/core/server-only";
import { createProvider } from "@beignet/core/providers";
import { env } from "@/lib/env";
import { createWebPushPort } from "./web-push";

export const webPushProvider = createProvider({
	name: "haunter-web-push",
	setup() {
		const configured = Boolean(
			env.WEB_PUSH_PUBLIC_KEY &&
				env.WEB_PUSH_PRIVATE_KEY &&
				env.WEB_PUSH_SUBJECT,
		);
		return {
			ports: {
				webPush: createWebPushPort(
					configured
						? {
								subject: env.WEB_PUSH_SUBJECT,
								publicKey: env.WEB_PUSH_PUBLIC_KEY as string,
								privateKey: env.WEB_PUSH_PRIVATE_KEY as string,
							}
						: undefined,
				),
			},
		};
	},
});
