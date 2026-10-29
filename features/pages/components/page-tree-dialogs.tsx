"use client";

import dynamic from "next/dynamic";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PageTreeNode } from "../client/page-tree-controller";
import { PAGE_TITLE_MAX_LENGTH } from "../schemas";

const PageIconPanel = dynamic(
	() =>
		import("./page-icon-panel").then((mod) => ({ default: mod.PageIconPanel })),
	{
		ssr: false,
		loading: () => <div className="h-[300px] w-[288px]" aria-hidden />,
	},
);

export function PageRenameDialog({
	open,
	value,
	error,
	pending,
	onChange,
	onCancel,
	onSubmit,
	className,
}: {
	open: boolean;
	value: string;
	error: string | null;
	pending: boolean;
	onChange: (value: string) => void;
	onCancel: () => void;
	onSubmit: () => void;
	className?: string;
}) {
	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
			title="Rename page"
			description="Choose a new name for this page."
			className={className}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit();
				}}
			>
				<Input
					autoFocus
					value={value}
					aria-label="Page title"
					aria-invalid={error ? true : undefined}
					maxLength={PAGE_TITLE_MAX_LENGTH}
					onChange={(event) => onChange(event.target.value)}
				/>
				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
				<ResponsiveDialogFooter>
					<Button type="submit" disabled={!value.trim() || pending}>
						Rename
					</Button>
				</ResponsiveDialogFooter>
			</form>
		</ResponsiveDialog>
	);
}

export function PageTrashDialog({
	page,
	pending,
	error,
	onCancel,
	onConfirm,
	className,
}: {
	page: Pick<PageTreeNode, "title" | "children"> | null;
	pending: boolean;
	error: string | null;
	onCancel: () => void;
	onConfirm: () => void;
	className?: string;
}) {
	return (
		<DestructiveConfirmationDialog
			open={page !== null}
			onOpenChange={(open) => {
				if (!pending && !open) onCancel();
			}}
			title="Move to trash?"
			description={
				<span className="break-words">
					Move {page?.title || "Untitled"}{" "}
					{page && page.children.length > 0 ? "and its subpages " : ""}
					to trash? You can restore it later from Trash.
				</span>
			}
			actionLabel="Move to trash"
			pendingLabel="Moving…"
			pending={pending}
			error={error}
			onConfirm={onConfirm}
			className={className}
		/>
	);
}

export function PageIconDialog({
	pageId,
	hasIcon,
	onClose,
	className,
}: {
	pageId: string | null;
	hasIcon: boolean;
	onClose: () => void;
	className?: string;
}) {
	return (
		<Dialog open={pageId !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className={cn("w-auto p-0", className)}>
				<DialogHeader className="sr-only">
					<DialogTitle>Change page icon</DialogTitle>
				</DialogHeader>
				{pageId ? (
					<PageIconPanel pageId={pageId} hasIcon={hasIcon} onDone={onClose} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}
