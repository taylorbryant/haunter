"use client";

import { rootFormError } from "@beignet/react-hook-form";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { authClient } from "@/client/auth-client";
import { authErrorMessage } from "@/client/error-feedback";
import { useCurrentUser } from "@/components/app-session-provider";
import { ThemeSettings } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { gravatarUrl } from "@/lib/gravatar";
import { cn } from "@/lib/utils";

/** Flat, Notion-style pane header: title + hairline, no card chrome. */
export function PanelHeader({
	title,
	description,
	destructive = false,
}: {
	title: string;
	description?: string;
	destructive?: boolean;
}) {
	return (
		<header className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<h2
					className={cn(
						"font-semibold text-base",
						destructive && "text-destructive",
					)}
				>
					{title}
				</h2>
				{description ? (
					<p className="text-muted-foreground text-sm">{description}</p>
				) : null}
			</div>
			<Separator />
		</header>
	);
}

export function Panel({ children }: { children: ReactNode }) {
	return <div className="flex flex-col gap-5">{children}</div>;
}

type ProfileValues = {
	name: string;
	email: string;
};

export function ProfilePanel() {
	const user = useCurrentUser();
	const [saved, setSaved] = useState(false);
	const [avatar, setAvatarValue] = useState(user?.image ?? null);
	const form = useForm<ProfileValues>({
		defaultValues: { name: "", email: "" },
		values: {
			name: user?.name ?? "",
			email: user?.email ?? "",
		},
	});

	const onSubmit = form.handleSubmit(async (values) => {
		form.clearErrors("root");
		setSaved(false);
		try {
			const updated = await authClient.updateUser({ name: values.name });
			if (updated.error) throw updated.error;
		} catch (profileError) {
			form.setError(
				"root",
				rootFormError(
					profileError,
					authErrorMessage(profileError, "Could not update your profile."),
				),
			);
			return;
		}

		if (values.email !== user?.email) {
			try {
				const changed = await authClient.changeEmail({
					newEmail: values.email,
				});
				if (changed.error) throw changed.error;
			} catch (emailError) {
				form.setError(
					"root",
					rootFormError(
						emailError,
						authErrorMessage(emailError, "Could not change your email."),
					),
				);
				return;
			}
		}

		setSaved(true);
	});

	async function setAvatar(image: string | null) {
		form.clearErrors("root");
		setSaved(false);
		try {
			// Better Auth accepts null to clear the image.
			const result = await authClient.updateUser({
				image: image as string | undefined,
			});
			if (result.error) throw result.error;
			setAvatarValue(image);
		} catch (avatarError) {
			form.setError(
				"root",
				rootFormError(
					avatarError,
					authErrorMessage(avatarError, "Could not update your avatar."),
				),
			);
		}
	}

	async function useGravatar() {
		if (!user?.email) return;
		try {
			await setAvatar(await gravatarUrl(user.email));
		} catch (avatarError) {
			form.setError(
				"root",
				rootFormError(avatarError, "Could not load your Gravatar."),
			);
		}
	}

	return (
		<Panel>
			<PanelHeader
				title="Profile"
				description="Update your name, avatar, and email address."
			/>
			<div className="flex items-center gap-4">
				<Avatar className="size-14">
					<AvatarImage src={avatar ?? undefined} alt="" />
					<AvatarFallback className="text-base">
						{(user?.name ?? "?").trim().slice(0, 2).toUpperCase() || "?"}
					</AvatarFallback>
				</Avatar>
				<div className="flex flex-col gap-1.5">
					<div className="flex gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={useGravatar}
						>
							Use Gravatar
						</Button>
						{avatar ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setAvatar(null)}
							>
								Remove
							</Button>
						) : null}
					</div>
					<p className="text-muted-foreground text-xs">
						Gravatar uses the photo linked to your email at gravatar.com; no
						photo there means your initials show instead.
					</p>
				</div>
			</div>
			<form className="flex max-w-sm flex-col gap-4" onSubmit={onSubmit}>
				<div className="flex flex-col gap-2">
					<Label htmlFor="name">Name</Label>
					<Input
						id="name"
						autoComplete="name"
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
						required
						{...form.register("email")}
					/>
				</div>
				{form.formState.errors.root ? (
					<p role="alert" className="text-destructive text-sm">
						{form.formState.errors.root.message}
					</p>
				) : null}
				<div className="flex items-center gap-3">
					<Button
						type="submit"
						size="sm"
						disabled={form.formState.isSubmitting}
					>
						{form.formState.isSubmitting ? "Saving…" : "Save changes"}
					</Button>
					{saved ? (
						<p role="status" className="text-muted-foreground text-sm">
							Saved.
						</p>
					) : null}
				</div>
			</form>
		</Panel>
	);
}

export function AppearancePanel() {
	return (
		<Panel>
			<PanelHeader
				title="Appearance"
				description="Choose a mode and the palette Haunter uses for light and dark appearances."
			/>
			<ThemeSettings />
		</Panel>
	);
}

export function DeleteAccountPanel() {
	const router = useRouter();
	const email = useCurrentUser()?.email ?? "";
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const matches =
		email !== "" && confirm.trim().toLowerCase() === email.toLowerCase();

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!matches || pending) return;
		setError(null);
		setPending(true);
		try {
			const result = await authClient.deleteUser();
			if (result.error) throw result.error;
			router.push("/");
			router.refresh();
		} catch (deleteError) {
			setPending(false);
			setError(
				rootFormError(
					deleteError,
					authErrorMessage(deleteError, "Could not delete your account."),
				).message,
			);
		}
	}

	return (
		<Panel>
			<PanelHeader
				title="Delete account"
				description="Permanently delete your account and all of its data. This cannot be undone."
				destructive
			/>
			<form className="flex max-w-sm flex-col gap-4" onSubmit={onSubmit}>
				<div className="flex flex-col gap-2">
					<Label htmlFor="delete-confirm">
						Type <span className="font-medium text-foreground">{email}</span> to
						confirm
					</Label>
					<Input
						id="delete-confirm"
						autoComplete="off"
						placeholder={email}
						value={confirm}
						onChange={(event) => setConfirm(event.target.value)}
					/>
				</div>
				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
				<div>
					<Button
						type="submit"
						variant="destructive"
						size="sm"
						disabled={!matches || pending}
					>
						{pending ? "Deleting…" : "Delete account"}
					</Button>
				</div>
			</form>
		</Panel>
	);
}
