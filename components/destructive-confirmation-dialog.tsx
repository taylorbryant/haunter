"use client";

import type { ReactNode } from "react";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";

export function DestructiveConfirmationDialog({
	open,
	onOpenChange,
	title,
	description,
	actionLabel,
	pendingLabel,
	pending = false,
	error,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	description: ReactNode;
	actionLabel: string;
	pendingLabel: string;
	pending?: boolean;
	error?: string | null;
	onConfirm: () => void;
}) {
	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			description={description}
			className="sm:max-w-sm"
		>
			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			) : null}
			<ResponsiveDialogFooter className="flex-col-reverse sm:flex-row">
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					onClick={() => onOpenChange(false)}
				>
					Cancel
				</Button>
				<Button
					type="button"
					variant="destructive"
					disabled={pending}
					onClick={onConfirm}
				>
					{pending ? pendingLabel : actionLabel}
				</Button>
			</ResponsiveDialogFooter>
		</ResponsiveDialog>
	);
}
