import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import {
	adminClient,
	emailOTPClient,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { accessControl, roles } from "@/lib/org-access";

import { sessionFetch } from "./session-recovery";
import { notifySessionChange } from "./session-signals";

export const authClient = createAuthClient({
	fetchOptions: {
		customFetchImpl: async (input, init) => {
			const path = String(input);
			const publicAuth =
				/\/(get-session|sign-in|sign-out|email-otp)(\/|\?|$)/.test(path);
			const response = await (publicAuth ? fetch : sessionFetch)(input, init);
			if (response.ok && /\/(sign-in|sign-out)(\/|\?|$)/.test(path))
				notifySessionChange();
			return response;
		},
	},
	plugins: [
		emailOTPClient(),
		organizationClient({ ac: accessControl, roles }),
		adminClient(),
		oauthProviderClient(),
	],
});
