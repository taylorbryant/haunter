import { ContractError } from "@beignet/core/client";

export type SessionStatus =
	| "authenticated"
	| "checking"
	| "expired"
	| "account-changed"
	| "access-lost"
	| "error";
export type SessionSnapshot = {
	status: SessionStatus;
	blocked: boolean;
	/** Retain restrictions across pending/failed checks until verification succeeds. */
	contentAccess: "available" | "read-only" | "hidden";
	message: string | null;
	workspaceId: string | null;
	role: string | null;
};
export type VerifiedSession = {
	userId: string;
	workspaceId: string | null;
	role: string | null;
};

export function isAuthenticationError(error: unknown): boolean {
	return (
		error instanceof ContractError &&
		(error.status === 401 || error.code === "SESSION_PAUSED")
	);
}

export class SessionRecovery {
	private snapshot: SessionSnapshot;
	private listeners = new Set<() => void>();
	private flight: Promise<boolean> | null = null;
	private abort: AbortController | null = null;
	private generation = 0;
	private automaticRecoveryUsed = false;
	private disposed = false;

	constructor(
		readonly userId: string,
		private verify: (
			signal: AbortSignal,
			recover: boolean,
		) => Promise<VerifiedSession | null>,
		initial: { workspaceId: string | null; role: string | null },
	) {
		this.snapshot = {
			status: "authenticated",
			blocked: false,
			contentAccess: "available",
			message: null,
			...initial,
		};
	}
	getSnapshot = () => this.snapshot;
	get epoch() {
		return this.generation;
	}
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private publish(next: Partial<SessionSnapshot>) {
		this.snapshot = { ...this.snapshot, ...next };
		for (const listener of this.listeners) listener();
	}
	/** Ignore failures from requests started before a newer identity check. */
	rejectRequest(epoch: number) {
		if (this.disposed || epoch !== this.generation || this.snapshot.blocked)
			return;
		this.invalidate();
		this.publish({ status: "checking", blocked: true, message: null });
		if (this.automaticRecoveryUsed) {
			this.publish({
				status: "error",
				message:
					"Your session could not resume saving. Check your sign-in to try again.",
			});
			return;
		}
		this.automaticRecoveryUsed = true;
		void this.check();
	}
	invalidate() {
		this.generation++;
		this.abort?.abort();
		this.flight = null;
	}
	/** An explicit sign-in/auth-change supersedes an older check. */
	recheck() {
		this.invalidate();
		this.automaticRecoveryUsed = false;
		this.publish({ blocked: true, status: "checking", message: null });
		return this.check(true);
	}
	check(explicit = false): Promise<boolean> {
		if (this.disposed) return Promise.resolve(false);
		if (this.flight) return this.flight;
		if (
			!explicit &&
			["account-changed", "access-lost", "error"].includes(this.snapshot.status)
		)
			return Promise.resolve(false);
		const generation = this.generation;
		const recovering = this.snapshot.blocked;
		const abort = new AbortController();
		this.abort = abort;
		const flight = Promise.resolve().then(async () => {
			try {
				const session = await this.verify(
					AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
					recovering,
				);
				if (this.disposed || generation !== this.generation) return false;
				if (!session) {
					this.generation++;
					this.publish({ status: "expired", blocked: true, message: null });
					return false;
				}
				if (session.userId !== this.userId) {
					this.generation++;
					this.publish({
						status: "account-changed",
						blocked: true,
						contentAccess: "hidden",
						message:
							"Another account is signed in. Sign in to the original account to recover your draft.",
					});
					return false;
				}
				this.publish({
					status: "authenticated",
					blocked: false,
					contentAccess: "available",
					message: null,
					workspaceId: session.workspaceId,
					role: session.role,
				});
				return true;
			} catch (error) {
				if (
					this.disposed ||
					generation !== this.generation ||
					abort.signal.aborted
				)
					return false;
				if (error instanceof WorkspaceSelectionError && !recovering) {
					return this.recheck();
				}
				if (error instanceof WorkspaceAccessError) {
					this.generation++;
					this.publish({
						status: "access-lost",
						blocked: true,
						contentAccess:
							this.snapshot.contentAccess === "hidden" ? "hidden" : "read-only",
						message:
							"Your workspace access changed. Download your draft or contact a workspace owner.",
					});
				} else if (recovering) {
					this.publish({
						status: "error",
						blocked: true,
						message:
							"Your connection could not be checked. Your draft is still here. Try again when you are online.",
					});
				}
				// Network failure during a healthy check is not evidence of expiry.
				return false;
			} finally {
				if (this.flight === flight) this.flight = null;
			}
		});
		this.flight = flight;
		return flight;
	}
	stop() {
		this.disposed = true;
		this.invalidate();
		this.listeners.clear();
	}
}

export class WorkspaceAccessError extends Error {}
export class WorkspaceSelectionError extends Error {}

let browserRecovery: SessionRecovery | null = null;
export function getBrowserSessionRecovery() {
	return typeof window === "undefined" ? null : browserRecovery;
}
export function installSessionRecovery(recovery: SessionRecovery) {
	browserRecovery = recovery;
	return () => {
		if (browserRecovery === recovery) browserRecovery = null;
	};
}

/** Preserve native responses and never replay a write at the transport layer. */
export const sessionFetch: typeof fetch = Object.assign(
	async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		const recovery = getBrowserSessionRecovery();
		const epoch = recovery?.epoch;
		if (recovery?.getSnapshot().blocked) {
			return Response.json(
				{ code: "SESSION_PAUSED", message: "Sign in to resume saving." },
				{ status: 401 },
			);
		}
		const response = await fetch(input, init);
		if (recovery && epoch !== undefined) {
			if (response.status === 401) recovery.rejectRequest(epoch);
			// A resource-specific 403 is not an expired session. Verify membership
			// before deciding whether all protected work should pause.
			if (response.status === 403 && epoch === recovery.epoch)
				void recovery.check();
			// Drop completions belonging to an earlier identity, including successful
			// writes. The durable draft remains until a verified retry acknowledges it.
			if (recovery.epoch !== epoch) {
				return Response.json(
					{ code: "SESSION_PAUSED", message: "Sign in to resume saving." },
					{ status: 401 },
				);
			}
		}
		return response;
	},
	{ preconnect: fetch.preconnect },
);

/** Query observers recompute this after cancellation and recovery invalidation. */
export function protectedRefetchInterval() {
	return getBrowserSessionRecovery()?.getSnapshot().blocked ? false : 30_000;
}
