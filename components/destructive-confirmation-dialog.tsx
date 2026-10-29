"use client";

import type { ReactNode } from "react";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
	className,
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
	className?: string;
}) {
	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			description={description}
			className={cn("sm:max-w-sm", className)}
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
