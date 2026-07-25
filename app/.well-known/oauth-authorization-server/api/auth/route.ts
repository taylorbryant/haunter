import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/better-auth";

export const GET = oauthProviderAuthServerMetadata(auth, {
	headers: {
		"Access-Control-Allow-Origin": "*",
		"Cache-Control": "public, max-age=300",
	},
});
