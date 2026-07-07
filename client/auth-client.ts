import {
	adminClient,
	emailOTPClient,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { accessControl, roles } from "@/lib/org-access";

export const authClient = createAuthClient({
	plugins: [
		emailOTPClient(),
		organizationClient({ ac: accessControl, roles }),
		adminClient(),
	],
});
