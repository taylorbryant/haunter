"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { useCurrentUser } from "@/components/app-session-provider";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { userErrorMessage } from "@/client/error-feedback";
import { refreshPageDocumentSessions } from "@/features/documents/client/session";
import { usePageRecoveries } from "@/features/documents/client/page-recoveries";
import { downloadPageRecovery } from "@/features/documents/client/recovery-files";
import type { LocalRecoveryCopy } from "@/features/documents/client/local-store";
import { RecoveryCopyActions } from "@/features/documents/components/recovery-copy-actions";
import { useRecoveryCopyActions } from "@/features/documents/client/use-recovery-copy-actions";
import { flushPendingPageSave } from "@/features/pages/client/save-state";
import {
	getPageVersionQueryOptions,
	invalidateBacklinks,
	invalidatePage,
	invalidatePages,
	invalidatePageVersions,
	listPageVersionsQueryOptions,
	restorePageVersionMutationOptions,
} from "@/features/pages/client/queries";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const ReadOnlyEditor = dynamic(() => import("./editor/read-only-editor"), {
	ssr: false,
	loading: () => <Skeleton className="h-40 w-full" />,
});
const RecoveryPreview = dynamic(() => import("./editor/recovery-preview"), {
	ssr: false,
	loading: () => <Skeleton className="h-40 w-full" />,
});

function formatWhen(iso: string) {
	return new Date(iso).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}
function versionSubtext(version: {
	cause: string;
	createdByName?: string | null;
}) {
	const cause = version.cause === "restore" ? "Before a restore" : "Checkpoint";
	return version.createdByName ? `${cause} · ${version.createdByName}` : cause;
}
function recoverySubtext(copy: LocalRecoveryCopy) {
	return copy.syncStatus === "unsynced"
		? "Includes edits not confirmed saved"
		: copy.syncStatus === "saved"
			? "Before the page changed · Saved"
			: "Before the page changed · Sync status unknown";
}

type Selection =
	| { type: "version"; id: string }
	| { type: "recovery"; generation: number };

export function PageHistoryDialog({
	pageId,
	workspaceId,
	initialRecovery,
	onOpenChange,
}: {
	pageId: string;
	workspaceId: string;
	initialRecovery?: number;
	onOpenChange: (open: boolean) => void;
}) {
	const isMobile = useIsMobile();
	const queryClient = useQueryClient();
	const user = useCurrentUser();
	const canEdit = useCanEditWorkspace();
	const url = process.env.NEXT_PUBLIC_COLLABORATION_URL;
	const identity =
		user && url ? { userId: user.id, workspaceId, pageId, url } : null;
	const local = usePageRecoveries(identity);
	const recoveryActions = useRecoveryCopyActions(workspaceId, {
		recoveryDownload: (generation) => {
			if (!identity) throw new Error("Sign in to open a recovery copy.");
			return downloadPageRecovery(identity, generation);
		},
	});
	const versionsQuery = useQuery(listPageVersionsQueryOptions(pageId));
	const versions = versionsQuery.data?.items ?? [];
	const [selection, setSelection] = useState<Selection | null>(
		initialRecovery === undefined
			? null
			: { type: "recovery", generation: initialRecovery },
	);
	const listRef = useRef<HTMLDivElement>(null);
	const previewHeadingRef = useRef<HTMLHeadingElement>(null);
	const previousSelection = useRef<Selection | null>(null);
	useEffect(() => {
		if (!isMobile) return;
		if (selection) previewHeadingRef.current?.focus();
		else if (previousSelection.current) {
			const previous = previousSelection.current;
			const key =
				previous.type === "version"
					? `version-${previous.id}`
					: `recovery-${previous.generation}`;
			listRef.current
				?.querySelector<HTMLButtonElement>(`[data-history-key="${key}"]`)
				?.focus();
		}
		previousSelection.current = selection;
	}, [isMobile, selection]);
	const selected =
		selection ??
		(isMobile
			? null
			: versions[0]
				? { type: "version" as const, id: versions[0].id }
				: local.copies[0]
					? {
							type: "recovery" as const,
							generation: local.copies[0].generation,
						}
					: null);
	const selectedVersion =
		selected?.type === "version"
			? versions.find((version) => version.id === selected.id)
			: undefined;
	const selectedRecovery =
		selected?.type === "recovery"
			? local.copies.find((copy) => copy.generation === selected.generation)
			: undefined;
	const previewQuery = useQuery({
		...getPageVersionQueryOptions(pageId, selectedVersion?.id ?? ""),
		enabled: !!selectedVersion,
	});
	const restoreMutation = useMutation({
		...restorePageVersionMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [preparing, setPreparing] = useState(false);
	const [restoreError, setRestoreError] = useState<string | null>(null);
	async function restore() {
		if (!canEdit || !selectedVersion || restoreMutation.isPending || preparing)
			return;
		setPreparing(true);
		setRestoreError(null);
		try {
			if (!(await flushPendingPageSave(pageId)))
				throw new Error(
					"Your current edits could not be saved. Reconnect and try again before restoring.",
				);
		} catch (error) {
			setRestoreError(
				error instanceof Error
					? error.message
					: "Your current edits could not be saved.",
			);
			setPreparing(false);
			return;
		}
		setPreparing(false);
		restoreMutation.mutate(
			{ path: { id: pageId, versionId: selectedVersion.id }, body: {} },
			{
				onError: (error) =>
					setRestoreError(
						userErrorMessage(error, "The version could not be restored."),
					),
				onSuccess: async (result) => {
					if (result.documentGeneration !== undefined)
						await refreshPageDocumentSessions(pageId);
					const invalidations = [
						invalidatePage(queryClient, pageId),
						invalidatePages(queryClient),
						invalidatePageVersions(queryClient, pageId),
					];
					if (result.tasksChanged) {
						invalidations.push(invalidateTasksWhenIdle(queryClient));
					}
					if (result.linksChanged) {
						invalidations.push(invalidateBacklinks(queryClient));
					}
					await Promise.all(invalidations);
					toast.add({ title: "Page restored", type: "success" });
					onOpenChange(false);
					// Collaborative editors switch generations without reloading the app.
					if (result.documentGeneration === undefined) window.location.reload();
				},
			},
		);
	}

	const list = (
		<div ref={listRef} className="space-y-5">
			<section aria-label="Saved versions">
				<h3 className="px-3 pb-2 font-medium text-muted-foreground text-xs">
					Saved versions
				</h3>
				{versionsQuery.isPending ? (
					<div className="space-y-2 p-2">
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
					</div>
				) : versionsQuery.isError && !versionsQuery.data ? (
					<div className="space-y-2 p-3">
						<p role="alert" className="text-destructive text-sm">
							Page history could not be loaded.
						</p>
						<Button
							size="sm"
							variant="outline"
							onClick={() => void versionsQuery.refetch()}
						>
							Try again
						</Button>
					</div>
				) : versions.length === 0 ? (
					<p className="px-3 text-muted-foreground text-sm">
						No versions yet. Checkpoints appear as you edit.
					</p>
				) : (
					versions.map((version) => (
						<button
							key={version.id}
							data-history-key={`version-${version.id}`}
							type="button"
							aria-pressed={selectedVersion?.id === version.id}
							className={cn(
								"keyboard-focus-ring flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-left text-sm hover:bg-accent",
								selectedVersion?.id === version.id && "bg-accent",
							)}
							onClick={() => {
								setSelection({ type: "version", id: version.id });
								setRestoreError(null);
							}}
						>
							<span>{formatWhen(version.createdAt)}</span>
							<span className="text-muted-foreground text-xs">
								{versionSubtext(version)}
							</span>
						</button>
					))
				)}
			</section>
			{identity ? (
				<section aria-label="On this device">
					<h3 className="px-3 pb-2 font-medium text-muted-foreground text-xs">
						On this device
					</h3>
					{local.error ? (
						<div className="space-y-2 px-3">
							<p role="alert" className="text-destructive text-sm">
								{local.error}
							</p>
							<Button variant="outline" size="sm" onClick={local.retry}>
								Try again
							</Button>
						</div>
					) : local.loading ? (
						<Skeleton className="h-12 w-full" />
					) : local.copies.length === 0 ? (
						<p className="px-3 text-muted-foreground text-sm">
							No earlier copies in this browser.
						</p>
					) : (
						local.copies.map((copy) => (
							<button
								key={copy.generation}
								data-history-key={`recovery-${copy.generation}`}
								type="button"
								aria-pressed={selectedRecovery?.generation === copy.generation}
								className={cn(
									"keyboard-focus-ring flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-left text-sm hover:bg-accent",
									selectedRecovery?.generation === copy.generation &&
										"bg-accent",
								)}
								onClick={() => {
									setSelection({
										type: "recovery",
										generation: copy.generation,
									});
									setRestoreError(null);
								}}
							>
								<span>
									{copy.archivedAt
										? formatWhen(copy.archivedAt)
										: `Previous copy ${copy.generation + 1}`}
								</span>
								<span className="text-muted-foreground text-xs">
									{recoverySubtext(copy)}
								</span>
							</button>
						))
					)}
				</section>
			) : null}
		</div>
	);
	const preview =
		selected?.type === "recovery" ? (
			selectedRecovery ? (
				<RecoveryPreview
					key={selectedRecovery.generation}
					update={selectedRecovery.update}
				/>
			) : (
				<p className="text-muted-foreground text-sm">
					{local.error ??
						(local.loading
							? "Loading copy from this browser…"
							: "This copy is no longer available in this browser.")}
				</p>
			)
		) : previewQuery.isPending ? (
			<Skeleton className="h-40 w-full" />
		) : previewQuery.isError && !previewQuery.data ? (
			<div className="space-y-2">
				<p role="alert" className="text-destructive text-sm">
					This version could not be loaded.
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={() => void previewQuery.refetch()}
				>
					Try again
				</Button>
			</div>
		) : previewQuery.data ? (
			<ReadOnlyEditor
				key={selectedVersion?.id}
				content={previewQuery.data.content}
				historyPreview
			/>
		) : (
			<p className="text-muted-foreground text-sm">
				Choose a version to preview.
			</p>
		);
	const actions = (
		<>
			{identity ? (
				<div hidden={!selectedRecovery}>
					<RecoveryCopyActions
						actions={recoveryActions}
						canCreate={canEdit}
						generation={selectedRecovery?.generation ?? -1}
					/>
				</div>
			) : null}
			{selectedVersion ? (
				<div className="space-y-2">
					{restoreError ? (
						<p role="alert" className="text-destructive text-sm">
							{restoreError}
						</p>
					) : null}
					<Button
						disabled={
							!canEdit ||
							restoreMutation.isPending ||
							preparing ||
							!previewQuery.data
						}
						onClick={restore}
					>
						{restoreMutation.isPending || preparing
							? "Restoring…"
							: "Restore this version"}
					</Button>
					<p className="text-muted-foreground text-xs">
						Your current page will be kept in history.
					</p>
				</div>
			) : null}
		</>
	);
	const previewTitle = selectedRecovery
		? "Earlier copy"
		: selectedVersion
			? formatWhen(selectedVersion.createdAt)
			: "Preview";
	const previewDescription = selectedRecovery
		? `Saved in this browser. ${selectedRecovery.syncStatus === "unsynced" ? "Includes edits not confirmed saved." : selectedRecovery.syncStatus === "unknown" ? "It may include unsynced edits." : "Edits were confirmed saved before the page changed."}`
		: selectedVersion
			? versionSubtext(selectedVersion)
			: "";
	if (isMobile)
		return (
			<Drawer showSwipeHandle open onOpenChange={onOpenChange}>
				<DrawerContent className="h-[85dvh]">
					<DrawerHeader className="relative pr-12 text-left">
						<DrawerTitle
							ref={previewHeadingRef}
							tabIndex={-1}
							className="outline-none"
						>
							{selected ? previewTitle : "Page history"}
						</DrawerTitle>
						<DrawerDescription>
							{selected
								? previewDescription
								: "Saved versions and earlier copies on this device."}
						</DrawerDescription>
						<Button
							variant="ghost"
							size="icon-sm"
							className="absolute top-3 right-3"
							aria-label="Close history"
							onClick={() => onOpenChange(false)}
						>
							<XIcon />
						</Button>
					</DrawerHeader>
					{selected ? (
						<div className="px-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setSelection(null)}
							>
								<ChevronLeftIcon />
								Back to history
							</Button>
						</div>
					) : null}
					<div
						className={cn(
							"min-h-0 flex-1 overflow-y-auto p-3",
							selected && "editor-flush p-4",
						)}
					>
						{selected ? preview : list}
					</div>
					<div
						hidden={!selected}
						className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
					>
						{actions}
					</div>
				</DrawerContent>
			</Drawer>
		);
	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="flex h-[80dvh] flex-col gap-4 sm:max-w-4xl">
				<DialogHeader className="pr-6">
					<DialogTitle>Page history</DialogTitle>
					<DialogDescription>
						Checkpoints are saved automatically as you edit. Earlier copies on
						this device stay in this browser.
					</DialogDescription>
				</DialogHeader>
				<div className="flex min-h-0 flex-1 gap-5">
					<div className="w-60 shrink-0 overflow-y-auto">{list}</div>
					<div className="flex min-w-0 flex-1 flex-col gap-3">
						{selected ? (
							<>
								<div>
									<h3 className="font-medium text-sm">{previewTitle}</h3>
									<p className="mt-1 text-muted-foreground text-xs">
										{previewDescription}
									</p>
								</div>
								<div className="editor-flush min-h-0 flex-1 overflow-y-auto rounded-lg bg-background p-4">
									{preview}
								</div>
							</>
						) : (
							<p className="text-muted-foreground text-sm">
								Choose a version to preview.
							</p>
						)}
						{actions}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
