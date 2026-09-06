import { authClient } from "./auth-client";

export async function sendSignInCode(email: string) {
	const result = await authClient.emailOtp.sendVerificationOtp({
		email: email.trim().toLowerCase(),
		type: "sign-in",
	});
	if (result.error) throw result.error;
}

export async function verifySignInCode(email: string, otp: string) {
	const result = await authClient.signIn.emailOtp({
		email: email.trim().toLowerCase(),
		otp,
	});
	if (result.error) throw result.error;
	return result;
}
