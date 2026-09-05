import { contractErrorMessage } from "@beignet/core/client";
import {
	isSessionExpiredError,
	reportSessionExpired,
	SESSION_EXPIRED_MESSAGE,
} from "@/client/session-expiration";

export type ErrorFeedbackMode = "global" | "inline" | "silent";

export type ErrorFeedbackMeta = {
	errorMode?: ErrorFeedbackMode;
	errorFallback?: string;
};

type ErrorListener = (message: string) => void;

const listeners = new Set<ErrorListener>();

export function userErrorMessage(
	error: unknown,
	fallback = "Something went wrong. Please try again.",
) {
	if (isSessionExpiredError(error)) return SESSION_EXPIRED_MESSAGE;
	return contractErrorMessage(error, fallback);
}

/**
 * Better Auth returns user-safe structured errors outside Beignet's
 * ContractError type. Keep their actionable message without teaching the
 * generic contract helper to expose arbitrary Error messages.
 */
export function authErrorMessage(error: unknown, fallback: string) {
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string" &&
		error.message.trim()
	) {
		return error.message.trim();
	}
	return fallback;
}

export function reportUserError(
	error: unknown,
	fallback = "Something went wrong. Please try again.",
) {
	if (reportSessionExpired(error)) return SESSION_EXPIRED_MESSAGE;
	const message =
		typeof error === "string" ? error : userErrorMessage(error, fallback);
	for (const listener of listeners) listener(message);
	return message;
}

/** Report an authenticated Better Auth failure without duplicating a 401 toast. */
export function reportAuthError(error: unknown, fallback: string) {
	if (reportSessionExpired(error)) return SESSION_EXPIRED_MESSAGE;
	return reportUserError(authErrorMessage(error, fallback));
}

export function subscribeUserErrors(listener: ErrorListener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
