import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import {
	adminClient,
	emailOTPClient,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { reportSessionExpired } from "@/client/session-expiration";
import { accessControl, roles } from "@/lib/org-access";

export const authClient = createAuthClient({
	fetchOptions: {
		onError: ({ error }) => {
			reportSessionExpired(error);
		},
	},
	plugins: [
		emailOTPClient(),
		organizationClient({ ac: accessControl, roles }),
		adminClient(),
		oauthProviderClient(),
	],
});
