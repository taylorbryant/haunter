"use client";

import { useEffect, useState } from "react";
import { sendSignInCode, verifySignInCode } from "@/client/email-code-auth";
import { authErrorMessage } from "@/client/error-feedback";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SessionRecoveryDialog({
	email,
	open,
	onOpenChange,
	onAuthenticated,
	restoreFocus,
}: {
	email: string;
	open: boolean;
	onOpenChange(open: boolean): void;
	onAuthenticated(): Promise<boolean>;
	restoreFocus(): void;
}) {
	const [sent, setSent] = useState(false);
	const [code, setCode] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (open) {
			setSent(false);
			setCode("");
			setError(null);
		}
	}, [open]);
	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (pending) return;
		setPending(true);
		setError(null);
		try {
			if (!sent) {
				await sendSignInCode(email);
				setSent(true);
			} else {
				await verifySignInCode(email, code);
				if (await onAuthenticated()) onOpenChange(false);
				else
					setError(
						"Signed in, but saving could not resume. Check the recovery message above your document.",
					);
			}
		} catch (failure) {
			setError(
				authErrorMessage(failure, "Sign-in could not be completed. Try again."),
			);
		} finally {
			setPending(false);
		}
	}
	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={onOpenChange}
			finalFocus={() => {
				restoreFocus();
				return false;
			}}
			title="Sign in to resume saving"
			description={`Your draft will stay open. We'll send a code to ${email}.`}
		>
			<form
				data-session-recovery-dialog
				onSubmit={submit}
				className="flex flex-col gap-4"
			>
				{sent ? (
					<div className="space-y-2">
						<Label htmlFor="recovery-code">6-digit code</Label>
						<Input
							id="recovery-code"
							name="code"
							autoFocus
							inputMode="numeric"
							autoComplete="one-time-code"
							maxLength={6}
							value={code}
							onChange={(event) =>
								setCode(event.target.value.replace(/\D/g, ""))
							}
						/>
					</div>
				) : null}
				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
				<Button type="submit" disabled={pending || (sent && code.length !== 6)}>
					{pending ? "Please wait…" : sent ? "Verify and resume" : "Send code"}
				</Button>
				{sent ? (
					<Button
						type="button"
						variant="ghost"
						disabled={pending}
						onClick={() => {
							setSent(false);
							setCode("");
							setError(null);
						}}
					>
						Send a new code
					</Button>
				) : null}
			</form>
		</ResponsiveDialog>
	);
}
