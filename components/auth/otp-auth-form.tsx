"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClient } from "@/client";
import { authClient } from "@/client/auth-client";
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
 * Passwordless sign-in/sign-up: email a 6-digit code, then verify it. An
 * unknown email creates the account (and gets a name step, since OTP signup
 * has nowhere else to ask). On success we seed the user's workspace
 * (idempotent) and land on their welcome page.
 */
export function OtpAuthForm() {
	const router = useRouter();
	const [step, setStep] = useState<"email" | "code" | "name">("email");
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function sendCode(event: React.FormEvent) {
		event.preventDefault();
		const address = email.trim();
		if (!address || pending) return;
		setError(null);
		setPending(true);
		const result = await authClient.emailOtp.sendVerificationOtp({
			email: address,
			type: "sign-in",
		});
		setPending(false);
		if (result.error) {
			setError(result.error.message || "Could not send a code. Try again.");
			return;
		}
		setStep("code");
	}

	async function verify(event?: React.FormEvent) {
		event?.preventDefault();
		if (code.length < 6 || pending) return;
		setError(null);
		setPending(true);
		const result = await authClient.signIn.emailOtp({
			email: email.trim(),
			otp: code,
		});
		if (result.error) {
			setPending(false);
			setError(result.error.message || "That code is invalid or expired.");
			return;
		}

		// A fresh OTP-created account has no name — ask for one before landing
		// in the app. Returning users skip straight through.
		if (!result.data?.user?.name) {
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
		const image = await gravatarUrl(email).catch(() => null);
		const trimmed = name.trim();
		const result = await authClient.updateUser({
			...(trimmed ? { name: trimmed } : {}),
			...(image ? { image } : {}),
		});
		if (result.error) {
			setPending(false);
			setError(result.error.message || "Could not save your name.");
			return;
		}
		await continueToApp();
	}

	async function continueToApp() {
		setPending(true);
		// A ?next= destination (set by the auth proxy) wins over the onboarding
		// landing page. Same-origin relative paths only — "//host" would be a
		// protocol-relative open redirect.
		const nextParam = new URLSearchParams(window.location.search).get("next");
		const nextPath =
			nextParam?.startsWith("/") && !nextParam.startsWith("//")
				? nextParam
				: null;

		// Signed in. Ensure the user has a workspace (a Better Auth organization),
		// make it active, then seed it (idempotent for returning users) and land
		// on the welcome page; fall back to home if anything fails.
		try {
			const { data: orgs } = await authClient.organization.list();
			let workspaceId = orgs?.[0]?.id ?? null;
			if (!workspaceId) {
				const created = await authClient.organization.create({
					name: "Personal",
					slug: `personal-${crypto.randomUUID().slice(0, 8)}`,
					logo: "🏡",
				});
				workspaceId = created.data?.id ?? null;
			}
			if (!workspaceId) throw new Error("Could not create a workspace.");
			await authClient.organization.setActive({ organizationId: workspaceId });
			const seeded = await apiClient.endpoint(onboard).call({ body: {} });
			router.push(
				nextPath ??
					(seeded.pageId
						? `/w/${seeded.workspaceId}/p/${seeded.pageId}`
						: `/w/${seeded.workspaceId}/tasks`),
			);
		} catch {
			router.push(nextPath ?? "/");
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
							: "What should we call you?"}
				</CardTitle>
				<CardDescription aria-live="polite">
					{step === "email"
						? "We'll email you a 6-digit code — no password needed."
						: step === "code"
							? `We sent a code to ${email}.`
							: "Your name is shown to people you share workspaces with."}
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
