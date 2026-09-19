"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import { userErrorMessage } from "@/client/error-feedback";
import { useDraftSafeRouter } from "@/client/use-draft-safe-router";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSidebar } from "@/components/ui/sidebar";
import {
	invalidatePages,
	invalidateBacklinks,
} from "@/features/pages/client/queries";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";
import {
	invalidateCanvasNavigation,
	invalidateCanvases,
} from "@/features/canvases/client/queries";
import { importRecovery } from "../contracts";
import { MAX_RECOVERY_FILE_BYTES, parseRecoveryFile } from "../recovery";

type Selection = {
	idempotencyKey: string;
	filename: string;
	file: string;
	bundle: ReturnType<typeof parseRecoveryFile>;
};

export function RecoveryImportDialog({
	workspaceId,
	onOpenChange,
}: {
	workspaceId: string;
	onOpenChange: (open: boolean) => void;
}) {
	const [selection, setSelection] = useState<Selection | null>(null);
	const [error, setError] = useState<string | null>(null);
	const selectionVersion = useRef(0);
	const mutation = useMutation(
		rq(importRecovery).mutationOptions({ meta: { errorMode: "inline" } }),
	);
	const queryClient = useQueryClient();
	const router = useDraftSafeRouter();
	const { isMobile, setOpenMobile, setSuppressMobileFinalFocus } = useSidebar();
	async function choose(file?: File) {
		const version = ++selectionVersion.current;
		setSelection(null);
		setError(null);
		if (!file) return;
		try {
			if (file.size > MAX_RECOVERY_FILE_BYTES)
				throw new Error("Recovery files must be 5 MB or smaller.");
			const text = await file.text();
			const bundle = parseRecoveryFile(text, file.name);
			if (version === selectionVersion.current)
				setSelection({
					idempotencyKey: crypto.randomUUID(),
					filename: file.name,
					file: text,
					bundle,
				});
		} catch (error) {
			if (version === selectionVersion.current)
				setError(
					error instanceof Error
						? error.message
						: "The recovery file could not be read.",
				);
		}
	}
	async function recover() {
		if (!selection || mutation.isPending) return;
		setError(null);
		try {
			const result = await mutation.mutateAsync({
				idempotencyKey: selection.idempotencyKey,
				body: {
					workspaceId,
					filename: selection.filename,
					file: selection.file,
				},
			});
			await Promise.all([
				invalidatePages(queryClient),
				invalidateTasksWhenIdle(queryClient),
				invalidateBacklinks(queryClient),
				invalidateCanvases(queryClient),
				invalidateCanvasNavigation(queryClient, workspaceId),
			]);
			onOpenChange(false);
			if (isMobile) {
				setSuppressMobileFinalFocus(true);
				setOpenMobile(false);
			}
			if (result.pages[0])
				router.push(`/w/${workspaceId}/p/${result.pages[0].id}`);
			else if (result.canvasIds[0])
				router.push(`/w/${workspaceId}/c/${result.canvasIds[0]}`);
		} catch (error) {
			setError(
				userErrorMessage(
					error,
					"The drafts could not be recovered. Your recovery file is unchanged.",
				),
			);
		}
	}
	return (
		<ResponsiveDialog
			open
			onOpenChange={(open) => {
				if (!mutation.isPending) onOpenChange(open);
			}}
			title="Recover drafts"
			description="Recover a Haunter JSON download as new pages and canvases in this workspace. Existing pages stay as they are. Markdown downloads can be opened with Import Markdown."
			className="sm:max-w-md"
		>
			<div className="flex flex-col gap-4">
				<Label htmlFor="recovery-file">Recovery file</Label>
				<Input
					id="recovery-file"
					type="file"
					accept=".json,application/json"
					disabled={mutation.isPending}
					onChange={(event) => void choose(event.target.files?.[0])}
				/>
				<p className="text-muted-foreground text-xs">One file, up to 5 MB.</p>
				{selection ? (
					<div className="space-y-2 text-sm">
						<p>
							{selection.bundle.pages.length} pages and{" "}
							{selection.bundle.canvases.length} canvases will be created.
						</p>
						<ul className="max-h-40 list-disc overflow-y-auto pl-5">
							{selection.bundle.pages.map((page) => (
								<li key={page.id}>{page.title || "Untitled"}</li>
							))}
						</ul>
					</div>
				) : null}
				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
			</div>
			<ResponsiveDialogFooter>
				<Button
					variant="outline"
					disabled={mutation.isPending}
					onClick={() => onOpenChange(false)}
				>
					Cancel
				</Button>
				<Button
					disabled={!selection || mutation.isPending}
					onClick={() => void recover()}
				>
					{mutation.isPending ? "Recovering…" : "Recover as new pages"}
				</Button>
			</ResponsiveDialogFooter>
		</ResponsiveDialog>
	);
}
