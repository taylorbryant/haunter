"use client";

import { rootFormError } from "@beignet/react-hook-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { authClient } from "@/client/auth-client";
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

type SignUpValues = {
	name: string;
	email: string;
	password: string;
};

export default function SignUpPage() {
	const router = useRouter();
	const form = useForm<SignUpValues>({
		defaultValues: { name: "", email: "", password: "" },
	});

	const onSubmit = form.handleSubmit(async (values) => {
		form.clearErrors("root");
		const result = await authClient.signUp.email({
			name: values.name,
			email: values.email,
			password: values.password,
		});

		if (result.error) {
			form.setError(
				"root",
				rootFormError(
					result.error,
					result.error.message || "Could not create your account.",
				),
			);
			return;
		}

		router.push("/");
		router.refresh();
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Create account</CardTitle>
				<CardDescription>Start building in a few seconds.</CardDescription>
			</CardHeader>
			<CardContent>
				<form className="flex flex-col gap-4" onSubmit={onSubmit}>
					<div className="flex flex-col gap-2">
						<Label htmlFor="name">Name</Label>
						<Input
							id="name"
							autoComplete="name"
							placeholder="Ada Lovelace"
							required
							{...form.register("name")}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="email">Email</Label>
						<Input
							id="email"
							type="email"
							autoComplete="email"
							placeholder="you@example.com"
							required
							{...form.register("email")}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							type="password"
							autoComplete="new-password"
							minLength={8}
							required
							{...form.register("password")}
						/>
					</div>
					{form.formState.errors.root ? (
						<p className="text-sm text-destructive">
							{form.formState.errors.root.message}
						</p>
					) : null}
					<Button type="submit" disabled={form.formState.isSubmitting}>
						{form.formState.isSubmitting
							? "Creating account..."
							: "Create account"}
					</Button>
				</form>
				<p className="mt-4 text-center text-sm text-muted-foreground">
					Already have an account?{" "}
					<Link
						className="text-foreground underline underline-offset-4"
						href="/sign-in"
					>
						Sign in
					</Link>
				</p>
			</CardContent>
		</Card>
	);
}
