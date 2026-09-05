"use client";

import { isContractError } from "@beignet/core/client";

type SessionExpiredListener = () => void;
type SessionRecoveryPreparer = () => Promise<void>;

const sessionExpiredListeners = new Set<SessionExpiredListener>();
const sessionRecoveryPreparers = new Set<SessionRecoveryPreparer>();
let sessionExpired = false;

export const SESSION_EXPIRED_MESSAGE =
	"Your session expired. Sign in again to continue syncing.";

export function isSessionExpiredError(error: unknown) {
	if (isContractError(error, 401)) return true;
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		error.status === 401
	);
}

/**
 * Turn any number of concurrent 401s into one shared piece of UI. The
 * subscriber owns visual de-duplication; callers only need to report the
 * expired-session signal instead of showing request-specific errors.
 */
export function reportSessionExpired(error: unknown) {
	if (!isSessionExpiredError(error)) return false;
	if (sessionExpired) return true;
	sessionExpired = true;
	for (const listener of sessionExpiredListeners) listener();
	return true;
}

export function getSessionExpiredSnapshot() {
	return sessionExpired;
}

export function clearSessionExpired() {
	if (!sessionExpired) return;
	sessionExpired = false;
	for (const listener of sessionExpiredListeners) listener();
}

export function subscribeSessionExpired(listener: SessionExpiredListener) {
	sessionExpiredListeners.add(listener);
	return () => {
		sessionExpiredListeners.delete(listener);
	};
}

/** Register an editor that can durably preserve its current local state. */
export function registerSessionRecoveryPreparer(
	prepare: SessionRecoveryPreparer,
) {
	sessionRecoveryPreparers.add(prepare);
	return () => {
		sessionRecoveryPreparers.delete(prepare);
	};
}

/**
 * Give every open editor a chance to finish its IndexedDB write before the
 * browser leaves for sign-in. A failed local write keeps the current tab open.
 */
export async function prepareForSessionRecovery() {
	const results = await Promise.allSettled(
		Array.from(sessionRecoveryPreparers, (prepare) => prepare()),
	);
	return results.every((result) => result.status === "fulfilled");
}
