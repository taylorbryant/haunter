"use client";

import { rootFormError } from "@beignet/react-hook-form";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { authClient } from "@/client/auth-client";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
	CODE_THEMES,
	setCodeThemeId,
	useCodeThemeId,
} from "@/features/pages/components/editor/code-theme";
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
	const session = authClient.useSession();
	const [saved, setSaved] = useState(false);
	const form = useForm<ProfileValues>({
		defaultValues: { name: "", email: "" },
		values: {
			name: session.data?.user.name ?? "",
			email: session.data?.user.email ?? "",
		},
	});

	const onSubmit = form.handleSubmit(async (values) => {
		form.clearErrors("root");
		setSaved(false);

		const updated = await authClient.updateUser({ name: values.name });
		if (updated.error) {
			form.setError(
				"root",
				rootFormError(
					updated.error,
					updated.error.message || "Could not update your profile.",
				),
			);
			return;
		}

		if (values.email !== session.data?.user.email) {
			const changed = await authClient.changeEmail({ newEmail: values.email });
			if (changed.error) {
				form.setError(
					"root",
					rootFormError(
						changed.error,
						changed.error.message || "Could not change your email.",
					),
				);
				return;
			}
		}

		await session.refetch();
		setSaved(true);
	});

	return (
		<Panel>
			<PanelHeader
				title="Profile"
				description="Update your name and email address."
			/>
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
					<p className="text-destructive text-sm">
						{form.formState.errors.root.message}
					</p>
				) : null}
				<div className="flex items-center gap-3">
					<Button
						type="submit"
						size="sm"
						disabled={form.formState.isSubmitting}
					>
						{form.formState.isSubmitting ? "Saving..." : "Save changes"}
					</Button>
					{saved ? (
						<p className="text-muted-foreground text-sm">Saved.</p>
					) : null}
				</div>
			</form>
		</Panel>
	);
}

export function AppearancePanel() {
	const codeThemeId = useCodeThemeId();
	const codeTheme =
		CODE_THEMES.find((theme) => theme.id === codeThemeId) ?? CODE_THEMES[0];

	return (
		<Panel>
			<PanelHeader
				title="Appearance"
				description="Choose how Haunter looks on this device."
			/>
			<div className="flex items-center justify-between gap-4">
				<div className="flex flex-col gap-0.5">
					<p className="font-medium text-sm">Theme</p>
					<p className="text-muted-foreground text-sm">
						Light, dark, or follow your system preference.
					</p>
				</div>
				<ThemeToggle />
			</div>
			<div className="flex items-center justify-between gap-4">
				<div className="flex flex-col gap-0.5">
					<p className="font-medium text-sm">Code highlighting</p>
					<p className="text-muted-foreground text-sm">
						Syntax theme for code blocks. Applies to pages you open next.
					</p>
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm">
							<span
								aria-hidden
								className="size-3 rounded-full border"
								style={{ backgroundColor: codeTheme.bg }}
							/>
							{codeTheme.label}
							<ChevronDownIcon className="opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{CODE_THEMES.map((theme) => (
							<DropdownMenuItem
								key={theme.id}
								onSelect={() => setCodeThemeId(theme.id)}
							>
								<span
									aria-hidden
									className="size-3 rounded-full border"
									style={{ backgroundColor: theme.bg }}
								/>
								{theme.label}
								{theme.id === codeThemeId ? (
									<CheckIcon className="ml-auto" />
								) : null}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</Panel>
	);
}

export function DeleteAccountPanel() {
	const router = useRouter();
	const session = authClient.useSession();
	const email = session.data?.user.email ?? "";
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
		const result = await authClient.deleteUser();
		if (result.error) {
			setPending(false);
			setError(result.error.message || "Could not delete your account.");
			return;
		}
		router.push("/");
		router.refresh();
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
				{error ? <p className="text-destructive text-sm">{error}</p> : null}
				<div>
					<Button
						type="submit"
						variant="destructive"
						size="sm"
						disabled={!matches || pending}
					>
						{pending ? "Deleting..." : "Delete account"}
					</Button>
				</div>
			</form>
		</Panel>
	);
}
