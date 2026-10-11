import { OtpAuthForm } from "@/components/auth/otp-auth-form";
import { publicPageViewport } from "@/components/public-page";

export const viewport = publicPageViewport;

export default function SignInPage() {
	return <OtpAuthForm />;
}
