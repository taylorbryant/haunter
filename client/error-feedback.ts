import { contractErrorMessage } from "@beignet/core/client";

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
	const message =
		typeof error === "string" ? error : userErrorMessage(error, fallback);
	for (const listener of listeners) listener(message);
	return message;
}

export function subscribeUserErrors(listener: ErrorListener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
