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
import { Button } from "@/components/ui/button";
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

/**
 * Header "Share" control: publish the current page to the web as a
 * read-only link, copy it, or revoke it. Rendered only on page routes for
 * members who can edit.
 */
export function ShareButton() {
	const pathname = usePathname();
	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;
	const canEdit = useCanEditWorkspace();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	const shareQuery = useQuery({
		...getPageShareQueryOptions(pageId ?? ""),
		enabled: open && pageId !== null,
	});
	const createMutation = useMutation(createPageShareMutationOptions());
	const revokeMutation = useMutation(revokePageShareMutationOptions());

	if (!pageId || !canEdit) return null;

	const share = shareQuery.data?.share ?? null;
	const shareUrl = share
		? `${window.location.origin}/share/${share.token}`
		: null;
	const busy = createMutation.isPending || revokeMutation.isPending;

	function publish() {
		if (!pageId || busy) return;
		createMutation.mutate(
			{ path: { pageId }, body: {} },
			{ onSuccess: () => invalidatePageShare(queryClient, pageId) },
		);
	}

	function revoke() {
		if (!pageId || busy) return;
		revokeMutation.mutate(
			{ path: { pageId } },
			{ onSuccess: () => invalidatePageShare(queryClient, pageId) },
		);
	}

	async function copy() {
		if (!shareUrl) return;
		await navigator.clipboard.writeText(shareUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}

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
				{shareQuery.isPending ? (
					<p className="text-muted-foreground text-sm">Loading…</p>
				) : share ? (
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
							onClick={revoke}
						>
							Revoke link
						</Button>
					</div>
				) : (
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
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
