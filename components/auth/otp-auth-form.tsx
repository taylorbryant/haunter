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
import { Label } from "@/components/ui/label";
import { onboard } from "@/features/workspaces/contracts";

/**
 * Passwordless sign-in/sign-up: email a 6-digit code, then verify it. An
 * unknown email creates the account. On success we seed the user's workspace
 * (idempotent) and land on their welcome page.
 */
export function OtpAuthForm() {
	const router = useRouter();
	const [step, setStep] = useState<"email" | "code">("email");
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
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

	async function verify(event: React.FormEvent) {
		event.preventDefault();
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
				seeded.pageId
					? `/w/${seeded.workspaceId}/p/${seeded.pageId}`
					: `/w/${seeded.workspaceId}/tasks`,
			);
		} catch {
			router.push("/");
		}
		router.refresh();
	}

	return (
		<Card>
			<CardHeader>
				<GhostLogo className="mb-1 size-9" />
				<CardTitle>
					{step === "email" ? "Sign in" : "Enter your code"}
				</CardTitle>
				<CardDescription>
					{step === "email"
						? "We'll email you a 6-digit code — no password needed."
						: `We sent a code to ${email}.`}
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
						{error ? <p className="text-destructive text-sm">{error}</p> : null}
						<Button type="submit" disabled={!email.trim() || pending}>
							{pending ? "Sending…" : "Send code"}
						</Button>
					</form>
				) : (
					<form className="flex flex-col gap-4" onSubmit={verify}>
						<div className="flex flex-col gap-2">
							<Label htmlFor="code">6-digit code</Label>
							<Input
								id="code"
								inputMode="numeric"
								autoComplete="one-time-code"
								maxLength={6}
								placeholder="123456"
								required
								autoFocus
								value={code}
								onChange={(event) =>
									setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
								}
								className="text-center text-lg tracking-[0.4em]"
							/>
						</div>
						{error ? <p className="text-destructive text-sm">{error}</p> : null}
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
