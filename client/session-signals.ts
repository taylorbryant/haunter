export const SESSION_CHANGE_KEY = "haunter:session-change";
export const SESSION_CHANGE_EVENT = "haunter-session-change";

export function notifySessionChange() {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
	try {
		localStorage.setItem(SESSION_CHANGE_KEY, crypto.randomUUID());
	} catch {
		/* Storage can be unavailable; focus checks still reconcile. */
	}
}
