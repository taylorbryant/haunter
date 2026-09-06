"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendSignInCode, verifySignInCode } from "@/client/email-code-auth";
import { apiClient } from "@/client";
import { authClient } from "@/client/auth-client";
import { authErrorMessage } from "@/client/error-feedback";
import { GhostLogo } from "@/components/ghost-logo";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { onboard } from "@/features/workspaces/contracts";
import { gravatarUrl } from "@/lib/gravatar";

/**
 * Passwordless sign-in. Unknown emails still receive the same OTP flow, then
 * land on a waitlist-only account after verification.
 */
export function OtpAuthForm() {
	const router = useRouter();
	const [step, setStep] = useState<"email" | "code" | "name" | "setup">(
		"email",
	);
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function sendCode(event: React.FormEvent) {
		event.preventDefault();
		const address = email.trim().toLowerCase();
		if (!address || pending) return;
		setError(null);
		setPending(true);
		setEmail(address);

		try {
			await sendSignInCode(address);
			setStep("code");
		} catch (sendError) {
			setError(
				authErrorMessage(sendError, "Could not send a code. Try again."),
			);
		} finally {
			setPending(false);
		}
	}

	async function verify(event?: React.FormEvent) {
		event?.preventDefault();
		if (code.length < 6 || pending) return;
		setError(null);
		setPending(true);
		let result: Awaited<ReturnType<typeof authClient.signIn.emailOtp>>;
		try {
			result = await verifySignInCode(email, code);
		} catch (verifyError) {
			setPending(false);
			setError(
				authErrorMessage(verifyError, "That code is invalid or expired."),
			);
			return;
		}

		const user = result.data?.user as
			| { accessStatus?: string; name?: string | null }
			| undefined;
		if (user?.accessStatus !== "approved") {
			const nextPath = getSafeNextPath();
			router.push(
				nextPath?.startsWith("/accept-invite/") ? nextPath : "/waitlist",
			);
			router.refresh();
			return;
		}

		// A fresh OTP-created account has no name — ask for one before landing
		// in the app. Returning users skip straight through.
		if (!user.name) {
			setPending(false);
			setStep("name");
			return;
		}

		await continueToApp();
	}

	async function submitName(event?: React.FormEvent) {
		event?.preventDefault();
		if (pending) return;
		setError(null);
		setPending(true);
		// Default the avatar to the email's Gravatar in the same update; the
		// URL 404s for addresses without one, and avatars fall back to
		// initials. Both are editable later in Settings.
		try {
			const image = await gravatarUrl(email).catch(() => null);
			const trimmed = name.trim();
			const result = await authClient.updateUser({
				...(trimmed ? { name: trimmed } : {}),
				...(image ? { image } : {}),
			});
			if (result.error) throw result.error;
			await continueToApp();
		} catch (nameError) {
			setPending(false);
			setError(authErrorMessage(nameError, "Could not save your name."));
		}
	}

	async function continueToApp() {
		setStep("setup");
		setError(null);
		setPending(true);
		// A ?next= destination (set by the auth proxy) wins over the onboarding
		// landing page. Same-origin relative paths only — "//host" would be a
		// protocol-relative open redirect.
		const nextPath = getSafeNextPath();

		// Signed in. Ensure the user has a workspace (a Better Auth organization),
		// make it active, then seed it (idempotent for returning users) and land
		// on the welcome page.
		try {
			const listed = await authClient.organization.list();
			if (listed.error) throw listed.error;
			const orgs = listed.data;
			let workspaceId = orgs?.[0]?.id ?? null;
			if (!workspaceId) {
				const created = await authClient.organization.create({
					name: "Personal",
					slug: `personal-${crypto.randomUUID().slice(0, 8)}`,
					logo: "🏡",
				});
				if (created.error) throw created.error;
				workspaceId = created.data?.id ?? null;
			}
			if (!workspaceId) throw new Error("Could not create a workspace.");
			const activated = await authClient.organization.setActive({
				organizationId: workspaceId,
			});
			if (activated.error) throw activated.error;
			const seeded = await apiClient.endpoint(onboard).call({ body: {} });
			router.push(
				nextPath ??
					(seeded.pageId
						? `/w/${seeded.workspaceId}/p/${seeded.pageId}`
						: `/w/${seeded.workspaceId}/tasks`),
			);
		} catch (continueError) {
			setPending(false);
			setError(
				authErrorMessage(
					continueError,
					"Could not finish setting up your account.",
				),
			);
			return;
		}
		router.refresh();
	}

	return (
		<Card>
			<CardHeader>
				<GhostLogo className="mb-1 size-9" />
				<CardTitle>
					{step === "email"
						? "Sign in"
						: step === "code"
							? "Enter your code"
							: step === "name"
								? "What should we call you?"
								: "Finish setting up"}
				</CardTitle>
				<CardDescription aria-live="polite">
					{step === "email"
						? "We'll email you a 6-digit code — no password needed."
						: step === "code"
							? `We sent a code to ${email}.`
							: step === "name"
								? "Your name is shown to people you share workspaces with."
								: "Your account is signed in. Haunter is preparing your workspace."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{step === "email" ? (
					<form className="flex flex-col gap-4" onSubmit={sendCode}>
						<div className="flex flex-col gap-2">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								type="email"
								autoComplete="email"
								placeholder="you@example.com"
								required
								autoFocus
								value={email}
								onChange={(event) => setEmail(event.target.value)}
							/>
						</div>
						{error ? (
							<p role="alert" className="text-destructive text-sm">
								{error}
							</p>
						) : null}
						<Button type="submit" disabled={!email.trim() || pending}>
							{pending ? "Sending…" : "Send code"}
						</Button>
					</form>
				) : step === "name" ? (
					<form className="flex flex-col gap-4" onSubmit={submitName}>
						<div className="flex flex-col gap-2">
							<Label htmlFor="name">Name</Label>
							<Input
								id="name"
								autoComplete="name"
								placeholder="e.g. Casper"
								autoFocus
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						</div>
						{error ? (
							<p role="alert" className="text-destructive text-sm">
								{error}
							</p>
						) : null}
						<Button type="submit" disabled={!name.trim() || pending}>
							{pending ? "Saving…" : "Continue"}
						</Button>
						<button
							type="button"
							className="text-center text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground"
							onClick={() => submitName()}
						>
							Skip for now
						</button>
					</form>
				) : step === "setup" ? (
					<div className="flex flex-col gap-4">
						{error ? (
							<p role="alert" className="text-destructive text-sm">
								{error}
							</p>
						) : null}
						<Button type="button" disabled={pending} onClick={continueToApp}>
							{pending ? "Setting up…" : "Try again"}
						</Button>
					</div>
				) : (
					<form className="flex flex-col gap-4" onSubmit={verify}>
						<div className="flex flex-col gap-2">
							<Label htmlFor="code">6-digit code</Label>
							<InputOTP
								id="code"
								maxLength={6}
								inputMode="numeric"
								autoComplete="one-time-code"
								autoFocus
								value={code}
								onChange={(next) => setCode(next.replace(/\D/g, ""))}
								// Typing the last digit submits; the button stays as the
								// fallback (verify no-ops while a request is pending).
								onComplete={() => verify()}
							>
								<InputOTPGroup>
									<InputOTPSlot index={0} />
									<InputOTPSlot index={1} />
									<InputOTPSlot index={2} />
								</InputOTPGroup>
								<InputOTPSeparator />
								<InputOTPGroup>
									<InputOTPSlot index={3} />
									<InputOTPSlot index={4} />
									<InputOTPSlot index={5} />
								</InputOTPGroup>
							</InputOTP>
						</div>
						{error ? (
							<p role="alert" className="text-destructive text-sm">
								{error}
							</p>
						) : null}
						<Button type="submit" disabled={code.length < 6 || pending}>
							{pending ? "Verifying…" : "Verify & continue"}
						</Button>
						<button
							type="button"
							className="text-center text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground"
							onClick={() => {
								setStep("email");
								setCode("");
								setError(null);
							}}
						>
							Use a different email
						</button>
					</form>
				)}
			</CardContent>
		</Card>
	);
}

function getSafeNextPath(): string | null {
	const nextParam = new URLSearchParams(window.location.search).get("next");
	return nextParam?.startsWith("/") && !nextParam.startsWith("//")
		? nextParam
		: null;
}
