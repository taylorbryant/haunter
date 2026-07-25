import { toNextJsHandler } from "better-auth/next-js";
import {
	auth,
	isDynamicOAuthClientRegistrationAtCapacity,
	prepareDynamicOAuthClientRegistration,
} from "@/lib/better-auth";
import {
	oauthDcrCapacityError,
	stripOAuthDcrInternalMetadata,
	validateOAuthDcrRequest,
	withOAuthDcrAllocation,
} from "@/lib/oauth-dcr-request";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(request: Request) {
	if (new URL(request.url).pathname !== "/api/auth/oauth2/register") {
		return handlers.POST(request);
	}

	const validation = await validateOAuthDcrRequest(request);
	if ("response" in validation) return validation.response;

	const { allocationKey, request: registrationRequest } = validation;
	const response = await withOAuthDcrAllocation(allocationKey, () =>
		handlers.POST(registrationRequest),
	);
	// Keep all lifecycle database work behind Better Auth's per-IP limiter.
	// The trigger is the authoritative race-safe ceiling; when it fires, turn
	// the adapter error into a standards-shaped temporary DCR response.
	if (response.status >= 500) {
		const atCapacity =
			await isDynamicOAuthClientRegistrationAtCapacity(allocationKey);
		if (atCapacity) {
			await prepareDynamicOAuthClientRegistration(
				allocationKey,
				new Date(),
			).catch(() => undefined);
			return oauthDcrCapacityError();
		}
	} else if (response.ok) {
		// Registration is already durable, so retirement is best-effort here;
		// the registered hourly schedule is the reliable cleanup path.
		await prepareDynamicOAuthClientRegistration(
			allocationKey,
			new Date(),
		).catch(() => undefined);
		return stripOAuthDcrInternalMetadata(response);
	}
	return response;
}
