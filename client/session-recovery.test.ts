import { describe, expect, test } from "bun:test";
import {
	SessionRecovery,
	WorkspaceAccessError,
	type VerifiedSession,
} from "./session-recovery";

const member = { userId: "owner", workspaceId: "workspace", role: "member" };
const initial = { workspaceId: member.workspaceId, role: member.role };
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("session recovery", () => {
	test("parallel unauthorized requests trigger one verification and preserve the owner", async () => {
		let calls = 0;
		const pending = deferred<null>();
		const recovery = new SessionRecovery(
			"owner",
			async () => {
				calls++;
				return pending.promise;
			},
			initial,
		);
		const epoch = recovery.epoch;
		for (let index = 0; index < 4; index++) recovery.rejectRequest(epoch);
		expect(recovery.getSnapshot()).toMatchObject({
			blocked: true,
			status: "checking",
		});
		const done = recovery.check();
		pending.resolve(null);
		await done;
		expect(calls).toBe(1);
		expect(recovery.userId).toBe("owner");
		expect(recovery.getSnapshot()).toMatchObject({
			blocked: true,
			status: "expired",
		});
	});
	test("a healthy-session 401 only retries recovery automatically once", async () => {
		let calls = 0;
		const recovery = new SessionRecovery(
			"owner",
			async () => {
				calls++;
				return member;
			},
			initial,
		);
		recovery.rejectRequest(recovery.epoch);
		await recovery.check();
		expect(recovery.getSnapshot().blocked).toBe(false);
		recovery.rejectRequest(recovery.epoch);
		await recovery.check();
		expect(calls).toBe(1);
		expect(recovery.getSnapshot()).toMatchObject({
			blocked: true,
			status: "error",
		});
		expect(await recovery.recheck()).toBe(true);
	});
	test("a late pre-sign-in response cannot overwrite a newer account check", async () => {
		const stale = deferred<typeof member>();
		let calls = 0;
		const recovery = new SessionRecovery(
			"owner",
			async () =>
				++calls === 1 ? stale.promise : { ...member, userId: "different" },
			initial,
		);
		const old = recovery.check();
		await Promise.resolve();
		await recovery.recheck();
		stale.resolve(member);
		await old;
		expect(recovery.getSnapshot()).toMatchObject({
			blocked: true,
			status: "account-changed",
		});
	});
	test("connectivity errors are not reported as expired sessions", async () => {
		const recovery = new SessionRecovery(
			"owner",
			async () => {
				throw new Error("offline");
			},
			initial,
		);
		await recovery.check();
		expect(recovery.getSnapshot()).toMatchObject({
			blocked: false,
			status: "authenticated",
		});
		recovery.rejectRequest(recovery.epoch);
		await recovery.check();
		expect(recovery.getSnapshot()).toMatchObject({
			blocked: true,
			status: "error",
		});
	});
	test("membership loss is distinct from expiration and never unblocks writes", async () => {
		const recovery = new SessionRecovery(
			"owner",
			async () => {
				throw new WorkspaceAccessError();
			},
			initial,
		);
		await recovery.check();
		expect(recovery.getSnapshot()).toMatchObject({
			blocked: true,
			status: "access-lost",
		});
	});
});

test.each([
	{ failure: { ...member, userId: "different" }, restriction: "hidden" },
	{ failure: new WorkspaceAccessError(), restriction: "read-only" },
])(
	"retains $restriction content restrictions until the original account and access are verified",
	async ({ failure, restriction }) => {
		let outcome: VerifiedSession | null | Error = failure;
		let pending: ReturnType<typeof deferred<void>> | null = null;
		const recovery = new SessionRecovery(
			"owner",
			async () => {
				await pending?.promise;
				if (outcome instanceof Error) throw outcome;
				return outcome;
			},
			initial,
		);
		try {
			await recovery.check();
			expect(recovery.getSnapshot().contentAccess).toBe(restriction);
			for (const next of [
				new TypeError("offline"),
				null,
				new WorkspaceAccessError(),
				failure,
			]) {
				outcome = next;
				pending = deferred<void>();
				const check = recovery.recheck();
				expect(recovery.getSnapshot()).toMatchObject({
					status: "checking",
					blocked: true,
					contentAccess: restriction,
				});
				pending.resolve();
				await check;
				expect(recovery.getSnapshot()).toMatchObject({
					blocked: true,
					contentAccess: restriction,
				});
			}
			outcome = member;
			pending = deferred<void>();
			const check = recovery.recheck();
			expect(recovery.getSnapshot().contentAccess).toBe(restriction);
			pending.resolve();
			expect(await check).toBe(true);
			expect(recovery.getSnapshot()).toMatchObject({
				status: "authenticated",
				blocked: false,
				contentAccess: "available",
			});
		} finally {
			recovery.stop();
		}
	},
);
