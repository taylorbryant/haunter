"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckIcon,
	CopyIcon,
	Globe2Icon,
	Share2Icon,
	XIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	createPageShareMutationOptions,
	getPageShareQueryOptions,
	invalidatePageShare,
	revokePageShareMutationOptions,
} from "@/features/shares/client/queries";
import { flushPendingPageSave } from "@/features/pages/client/save-state";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";

/**
 * The share controls for one page: publish a read-only web link, copy it,
 * revoke it. Hosted by the desktop popover and the mobile drawer.
 */
export function SharePanel({
	pageId,
	active,
}: {
	pageId: string;
	/** Defer fetching until the hosting surface is open. */
	active: boolean;
}) {
	const queryClient = useQueryClient();
	const [copied, setCopied] = useState(false);
	const [flushError, setFlushError] = useState<string | null>(null);
	const [flushing, setFlushing] = useState(false);
	const [revokeOpen, setRevokeOpen] = useState(false);

	const shareQuery = useQuery({
		...getPageShareQueryOptions(pageId),
		enabled: active,
	});
	const createMutation = useMutation(createPageShareMutationOptions());
	const revokeMutation = useMutation(revokePageShareMutationOptions());

	const share = shareQuery.data?.share ?? null;
	const shareUrl = share
		? `${window.location.origin}/share/${share.token}`
		: null;
	const busy = flushing || createMutation.isPending || revokeMutation.isPending;

	async function flushBeforeShare() {
		setFlushError(null);
		setFlushing(true);
		try {
			if (await flushPendingPageSave(pageId)) return true;
			setFlushError("Save this page before sharing.");
			return false;
		} finally {
			setFlushing(false);
		}
	}

	async function publish() {
		if (busy) return;
		if (!(await flushBeforeShare())) return;
		createMutation.mutate(
			{ path: { pageId }, body: {} },
			{ onSuccess: () => invalidatePageShare(queryClient, pageId) },
		);
	}

	function revoke() {
		if (busy) return;
		revokeMutation.mutate(
			{ path: { pageId } },
			{
				onSuccess: async () => {
					setRevokeOpen(false);
					await invalidatePageShare(queryClient, pageId);
				},
			},
		);
	}

	async function copy() {
		if (!shareUrl) return;
		if (!(await flushBeforeShare())) return;
		await navigator.clipboard.writeText(shareUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}

	if (shareQuery.isPending) {
		return <p className="text-muted-foreground text-sm">Loading…</p>;
	}

	if (share) {
		return (
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<Globe2Icon className="size-4 text-muted-foreground" />
					<div className="flex flex-col">
						<p className="font-medium text-sm">Shared to the web</p>
						<p className="text-muted-foreground text-xs">
							Anyone with the link can view this page.
						</p>
					</div>
				</div>
				<div className="flex gap-2">
					<Input readOnly value={shareUrl ?? ""} className="h-8 text-xs" />
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={copy}
						aria-label="Copy link"
					>
						{copied ? <CheckIcon /> : <CopyIcon />}
					</Button>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="w-fit text-destructive hover:text-destructive"
					disabled={busy}
					onClick={() => setRevokeOpen(true)}
				>
					Revoke link
				</Button>
				{flushError ? (
					<p className="text-destructive text-xs">{flushError}</p>
				) : null}
				<DestructiveConfirmationDialog
					open={revokeOpen}
					onOpenChange={setRevokeOpen}
					title="Revoke public link?"
					description="Anyone with this link will lose access. You can publish a new link later."
					actionLabel="Revoke link"
					pendingLabel="Revoking…"
					pending={busy}
					onConfirm={revoke}
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<Globe2Icon className="size-4 text-muted-foreground" />
				<div className="flex flex-col">
					<p className="font-medium text-sm">Share to the web</p>
					<p className="text-muted-foreground text-xs">
						Publish a read-only link anyone can open.
					</p>
				</div>
			</div>
			<Button type="button" size="sm" disabled={busy} onClick={publish}>
				{busy ? "Publishing…" : "Publish"}
			</Button>
			{flushError ? (
				<p className="text-destructive text-xs">{flushError}</p>
			) : null}
		</div>
	);
}

/**
 * Mobile share surface: a bottom drawer, opened from the header's page
 * actions menu (no trigger of its own).
 */
export function ShareDrawer({
	pageId,
	open,
	onOpenChange,
}: {
	pageId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Drawer showSwipeHandle open={open} onOpenChange={onOpenChange}>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>Share</DrawerTitle>
					<DrawerDescription className="sr-only">
						Share this page to the web
					</DrawerDescription>
				</DrawerHeader>
				<div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
					<SharePanel pageId={pageId} active={open} />
				</div>
			</DrawerContent>
		</Drawer>
	);
}

/**
 * Desktop header "Share" control (a popover). On mobile the share surface
 * lives inside the header's page actions menu instead.
 */
export function ShareButton() {
	const pathname = usePathname();
	const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const canEdit = useCanEditWorkspace();
	const [open, setOpen] = useState(false);

	if (!pageId || !canEdit || !synced) return null;

	return (
		// modal: non-modal Radix popovers don't dismiss on outside taps in iOS
		// Safari (taps on non-interactive page area never reach the dismiss
		// layer). Modal mode closes reliably everywhere.
		<Popover modal open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button variant="ghost" size="sm" className="text-muted-foreground" />
				}
			>
				<Share2Icon />
				Share
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80">
				{/* Explicit close: outside-tap dismissal has platform quirks on
				    touch devices, so the popover always offers a visible way out. */}
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="absolute top-1.5 right-1.5 text-muted-foreground"
					onClick={() => setOpen(false)}
				>
					<XIcon />
					<span className="sr-only">Close</span>
				</Button>
				<SharePanel pageId={pageId} active={open} />
			</PopoverContent>
		</Popover>
	);
}
